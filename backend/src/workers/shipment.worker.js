const { randomUUID: uuid } = require('crypto');
const crypto = require('crypto');
const pool = require('../config/database');
const { isProcessed, markProcessed } = require('../utils/idempotency');
const { assertTransition } = require('../utils/stateMachine');
const logger = require('../utils/logger');

function makeTrackingNumber() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `TRK-${date}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

async function handleDelivered(boss, orderId) {
  const deliveredJobsId = `delivered_jobs_${orderId}`;

  // Fast path: order marked delivered AND notification confirmed sent.
  if (await isProcessed(deliveredJobsId)) return;

  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query('BEGIN');
    inTransaction = true;

    const { rows } = await client.query(
      'SELECT status FROM orders WHERE id = $1 FOR UPDATE', [orderId]
    );
    const order = rows[0];

    if (!order || order.status === 'cancelled') {
      await client.query('ROLLBACK');
      inTransaction = false;
      logger.warn('handleDelivered: terminal state, sealing', { orderId, status: order?.status });
      await markProcessed(deliveredJobsId, 'delivered.jobs');
      return;
    }

    if (order.status !== 'delivered') {
      // Do not use assertTransition here: the automated courier path moves
      // directly from 'processing' → 'delivered' without an explicit 'shipped'
      // step, which is valid for the mock flow.
      await client.query(
        `UPDATE orders SET status = 'delivered', updated_at = NOW() WHERE id = $1`, [orderId]
      );
      await client.query(
        `INSERT INTO order_status_log (id, order_id, from_status, to_status, note, created_at)
         VALUES ($1, $2, $3, 'delivered', 'Shipment delivered', NOW())`,
        [uuid(), orderId, order.status]
      );
      await client.query('COMMIT');
      inTransaction = false;
      logger.info('Order marked delivered', { orderId });
    } else {
      // Already delivered — process crashed after COMMIT but before notification sent.
      await client.query('ROLLBACK');
      inTransaction = false;
      logger.info('handleDelivered: already delivered; re-sending notification', { orderId });
    }

    // Always attempt notification send before sealing. Notification worker
    // must handle duplicate delivery events idempotently.
    await boss.send('notification/order-delivered', { orderId }, { retryLimit: 3 });
    await markProcessed(deliveredJobsId, 'delivered.jobs');

  } catch (err) {
    if (inTransaction) await client.query('ROLLBACK').catch(() => {});
    logger.error('handleDelivered error', { err: err.message, orderId });
    throw err;
  } finally {
    client.release();
  }
}

module.exports = async function register(boss) {

  await boss.createQueue('shipment/create-shipment');
  await boss.createQueue('shipment/advance-shipment');

  // ── Create shipment after payment ─────────────────────────────────────────
  await boss.work('shipment/create-shipment', { teamSize: 5 }, async (jobs) => {
    const job = Array.isArray(jobs) ? jobs[0] : jobs;
    if (!job?.data) return;
    const { orderId } = job.data;
    const eventId = `shipment_create_${orderId}`;   // guards DB write
    const jobsId  = `shipment_jobs_${orderId}`;     // guards downstream sends

    // Fast path: delivery created AND downstream jobs confirmed sent.
    if (await isProcessed(jobsId)) {
      logger.info('Shipment creation fully processed, skipping', { orderId });
      return;
    }

    const client = await pool.connect();
    let inTransaction = false;
    let trackingNumber;
    try {
      await client.query('BEGIN');
      inTransaction = true;

      const { rows: orderRows } = await client.query(
        'SELECT id, status, fulfillment_method FROM orders WHERE id = $1 FOR UPDATE', [orderId]
      );
      const order = orderRows[0];
      if (!order) throw new Error(`Order not found: ${orderId}`);

      if (order.fulfillment_method === 'pickup') {
        await client.query('ROLLBACK');
        inTransaction = false;
        await markProcessed(eventId, 'shipment.skip_pickup');
        await markProcessed(jobsId, 'shipment.jobs');
        logger.info('Order is pickup, skipping courier delivery creation', { orderId });
        return;
      }

      const { rows: existing } = await client.query(
        'SELECT tracking_number FROM deliveries WHERE order_id = $1', [orderId]
      );

      if (existing.length > 0) {
        // Delivery already created — process crashed after COMMIT but before
        // downstream jobs were sent. Recover the tracking number and fall through.
        trackingNumber = existing[0].tracking_number;
        await client.query('ROLLBACK');
        inTransaction = false;
        logger.info('Delivery already exists; re-attempting downstream jobs', { orderId, trackingNumber });

      } else {
        const needsProcessing = order.status !== 'processing';
        if (needsProcessing) {
          assertTransition(order.status, 'processing');
        }

        trackingNumber = makeTrackingNumber();

        await client.query(
          `INSERT INTO deliveries (id, order_id, tracking_number, status, created_at, updated_at)
           VALUES ($1, $2, $3, 'pending', NOW(), NOW())`,
          [uuid(), orderId, trackingNumber]
        );
        if (needsProcessing) {
          await client.query(
            `UPDATE orders SET status = 'processing', updated_at = NOW() WHERE id = $1`, [orderId]
          );
          await client.query(
            `INSERT INTO order_status_log (id, order_id, from_status, to_status, note, created_at)
             VALUES ($1, $2, $3, 'processing', 'Shipment created, awaiting dispatch', NOW())`,
            [uuid(), orderId, order.status]
          );
        }
        await markProcessed(eventId, 'shipment.create', client);
        await client.query('COMMIT');
        inTransaction = false;

        logger.info('Shipment created', { orderId, trackingNumber });
      }

      // Enqueue downstream jobs. singletonKey prevents duplicate advance-shipment
      // entries when this handler retries after a partial crash — pg-boss silently
      // drops the duplicate send if a pending job with the same key already exists.
      await boss.send(
        'shipment/advance-shipment',
        { trackingNumber, orderId },
        { startAfter: 10, retryLimit: 3, singletonKey: trackingNumber }
      );
      await boss.send('notification/shipment-created', { orderId, trackingNumber }, { retryLimit: 3 });

      // Completion seal — written last so a crash mid-send is retryable.
      await markProcessed(jobsId, 'shipment.jobs');
      logger.info('Shipment jobs enqueued', { orderId, trackingNumber, jobs: ['advance-shipment', 'shipment-created'] });

    } catch (err) {
      if (inTransaction) await client.query('ROLLBACK').catch(() => {});
      logger.error('create-shipment worker error', { err: err.message, orderId });
      throw err;
    } finally {
      client.release();
    }
  });

  // ── Advance shipment through courier lifecycle ────────────────────────────
  await boss.work('shipment/advance-shipment', { teamSize: 5 }, async (jobs) => {
    const job = Array.isArray(jobs) ? jobs[0] : jobs;
    if (!job?.data) return;
    const { trackingNumber, orderId } = job.data;
    const courierService = require('../services/courier.service');
    const result = await courierService.advanceShipment(trackingNumber);

    if (!result) {
      logger.warn('advanceShipment returned nothing', { trackingNumber, orderId });
      return;
    }

    if (result.alreadyDelivered) {
      logger.info('Shipment already delivered', { trackingNumber, orderId });
      return;
    }

    logger.info('Shipment advanced', { trackingNumber, orderId, from: result.from, to: result.to });

    if (result.to === 'delivered') {
      await handleDelivered(boss, orderId);
      return;
    }

    // singletonKey prevents stacking multiple pending advance jobs for the same
    // shipment if this handler retries.
    await boss.send(
      'shipment/advance-shipment',
      { trackingNumber, orderId },
      { startAfter: 10, retryLimit: 3, singletonKey: trackingNumber }
    );
  });

  logger.info('Shipment workers registered');
};

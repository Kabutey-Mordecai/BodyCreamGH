const { v4: uuid } = require('uuid');
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT status FROM orders WHERE id = $1 FOR UPDATE', [orderId]
    );
    const order = rows[0];
    if (!order || order.status === 'delivered') {
      await client.query('ROLLBACK');
      return;
    }
    if (order.status === 'cancelled') {
      await client.query('ROLLBACK');
      logger.warn('handleDelivered: order is cancelled, skipping', { orderId });
      return;
    }
    // Do not use assertTransition here: the automated courier path moves
    // directly from 'processing' → 'delivered' without an explicit 'shipped'
    // step, which is valid for the mock flow.
    await client.query(`UPDATE orders SET status = 'delivered', updated_at = NOW() WHERE id = $1`, [orderId]);
    await client.query(
      `INSERT INTO order_status_log (id, order_id, from_status, to_status, note, created_at)
       VALUES ($1, $2, $3, 'delivered', 'Shipment delivered', NOW())`,
      [uuid(), orderId, order.status]
    );
    await client.query('COMMIT');
    logger.info('Order marked delivered', { orderId });
    await boss.send('notification/order-delivered', { orderId }, { retryLimit: 3 });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
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
  await boss.work('shipment/create-shipment', { teamSize: 5 }, async (job) => {
    const { orderId } = job.data;
    const eventId = `shipment_create_${orderId}`;

    if (await isProcessed(eventId)) {
      logger.info('Duplicate shipment creation skipped', { orderId });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: orderRows } = await client.query(
        'SELECT id, status FROM orders WHERE id = $1 FOR UPDATE', [orderId]
      );
      const order = orderRows[0];
      if (!order) throw new Error(`Order not found: ${orderId}`);

      const { rows: existing } = await client.query(
        'SELECT id FROM deliveries WHERE order_id = $1', [orderId]
      );
      if (existing.length > 0) {
        await client.query('ROLLBACK');
        logger.info('Delivery already exists', { orderId });
        return;
      }

      const needsProcessing = order.status !== 'processing';
      if (needsProcessing) {
        assertTransition(order.status, 'processing');
      }

      const trackingNumber = makeTrackingNumber();

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

      logger.info('Shipment created', { orderId, trackingNumber });

      // First courier advance after 10 seconds
      await boss.send('shipment/advance-shipment', { trackingNumber, orderId }, { startAfter: 10, retryLimit: 3 });
      await boss.send('notification/shipment-created', { orderId, trackingNumber }, { retryLimit: 3 });

    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error('create-shipment worker error', { err: err.message, orderId });
      throw err;
    } finally {
      client.release();
    }
  });

  // ── Advance shipment through courier lifecycle ────────────────────────────
  await boss.work('shipment/advance-shipment', { teamSize: 5 }, async (job) => {
    const { trackingNumber, orderId } = job.data;
    const courierService = require('../services/courier.service');
    const result = await courierService.advanceShipment(trackingNumber);

    if (!result) {
      logger.warn('advanceShipment returned nothing', { trackingNumber });
      return;
    }

    if (result.alreadyDelivered) {
      logger.info('Shipment already delivered', { trackingNumber });
      return;
    }

    logger.info('Shipment advanced', { trackingNumber, from: result.from, to: result.to });

    if (result.to === 'delivered') {
      await handleDelivered(boss, orderId);
      return;
    }

    // Schedule next advance in 10 seconds
    await boss.send('shipment/advance-shipment', { trackingNumber, orderId }, { startAfter: 10, retryLimit: 3 });
  });

  logger.info('Shipment workers registered');
};

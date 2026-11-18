'use strict';

const crypto = require('crypto');
const { randomUUID: uuid } = require('crypto');
const pool = require('../config/database');
const paystackAPI = require('../config/paystack');
const OrderModel = require('../models/order.model');
const { logStatusChange } = require('../utils/audit');
const logger = require('../utils/logger');

const REFUND_SUCCESS_EVENTS = new Set(['refund.processed']);
const REFUND_FAILED_EVENTS = new Set(['refund.failed']);
const REFUND_STATUS_EVENTS = new Set([
  'refund.pending',
  'refund.processing',
  'refund.needs-attention',
]);

// ── Initialize payment (authenticated user) ───────────────────────────────────
const initializePayment = async (req, res) => {
  try {
    const { orderId } = req.body;

    const order = await OrderModel.findById(orderId, req.user.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.payment_status === 'paid') return res.status(400).json({ error: 'Order already paid' });

    const callbackUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment/callback`;
    const response = await paystackAPI.post('/transaction/initialize', {
      email:        req.user.email,
      amount:       Math.round(parseFloat(order.total_amount) * 100), // pesewas
      currency:     'GHS',
      callback_url: callbackUrl,
      metadata:     { orderId, userId: req.user.id },
    });

    await pool.query(
      `INSERT INTO payments (id, order_id, amount, status, paystack_reference, customer_email, payment_method)
       VALUES ($1,$2,$3,'pending',$4,$5,'paystack')
       ON CONFLICT (paystack_reference) DO NOTHING`,
      [uuid(), orderId, order.total_amount, response.data.data.reference, req.user.email]
    );

    res.json({
      authorization_url: response.data.data.authorization_url,
      access_code:       response.data.data.access_code,
      reference:         response.data.data.reference,
    });
  } catch (error) {
    logger.error('Paystack init error', { err: error.response?.data || error.message });
    res.status(500).json({ error: 'Failed to initialize payment' });
  }
};

// ── Initialize payment (guest checkout) ──────────────────────────────────────
const initializeGuestPayment = async (req, res) => {
  try {
    const { orderId, email } = req.body;
    if (!orderId || !email) return res.status(400).json({ error: 'orderId and email are required' });

    const order = await OrderModel.findById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.payment_status === 'paid') return res.status(400).json({ error: 'Order already paid' });

    // Only true guest orders (no customer_id and with a recorded guest_email) may use guest checkout payment.
    if (order.customer_id !== null && order.customer_id !== undefined) {
      return res.status(403).json({ error: 'Guest payment is not allowed for this order.' });
    }
    if (!order.guest_email || order.guest_email.toLowerCase() !== String(email).toLowerCase()) {
      return res.status(403).json({ error: 'Email does not match the order.' });
    }

    const callbackUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment/callback`;
    const response = await paystackAPI.post('/transaction/initialize', {
      email,
      amount:       Math.round(parseFloat(order.total_amount) * 100),
      currency:     'GHS',
      callback_url: callbackUrl,
      metadata:     { orderId, guest: true },
    });

    await pool.query(
      `INSERT INTO payments (id, order_id, amount, status, paystack_reference, customer_email, payment_method)
       VALUES ($1,$2,$3,'pending',$4,$5,'paystack')
       ON CONFLICT (paystack_reference) DO NOTHING`,
      [uuid(), orderId, order.total_amount, response.data.data.reference, email]
    );

    res.json({
      authorization_url: response.data.data.authorization_url,
      access_code:       response.data.data.access_code,
      reference:         response.data.data.reference,
    });
  } catch (error) {
    logger.error('Paystack guest init error', { err: error.response?.data || error.message });
    res.status(500).json({ error: 'Failed to initialize payment' });
  }
};

// ── Verify payment (frontend callback) ───────────────────────────────────────
// Called by the frontend after Paystack redirects back.
//
// Updates the order synchronously (pending → confirmed, payment_status → paid)
// so the admin sees the correct state immediately. Then enqueues the
// payment.success job for downstream work (shipment, notification emails).
// The worker's "already paid" branch handles the duplicate safely — it skips
// the DB write and only re-enqueues downstream jobs if they weren't sent yet.
const verifyPayment = async (req, res) => {
  try {
    const { reference } = req.body;
    if (!reference || typeof reference !== 'string') {
      return res.status(400).json({ error: 'Payment reference is required' });
    }

    const response = await paystackAPI.get(`/transaction/verify/${encodeURIComponent(reference)}`);
    const txData = response.data.data;

    if (!txData || txData.status !== 'success') {
      await pool.query(
        `UPDATE payments SET status='failed', updated_at=NOW() WHERE paystack_reference=$1`,
        [reference]
      );
      return res.status(400).json({ error: 'Payment failed or not completed' });
    }

    // Resolve and cross-check orderId ownership between metadata and payments table
    let metadata = txData.metadata;
    if (typeof metadata === 'string') { try { metadata = JSON.parse(metadata); } catch { metadata = {}; } }
    metadata = (metadata && typeof metadata === 'object') ? metadata : {};
    const metadataOrderId = metadata.orderId || metadata.order_id || null;

    const { rows: paymentRows } = await pool.query(
      'SELECT order_id FROM payments WHERE paystack_reference = $1',
      [reference]
    );
    const dbOrderId = paymentRows[0]?.order_id || null;

    if (dbOrderId && metadataOrderId && String(dbOrderId) !== String(metadataOrderId)) {
      logger.error('verifyPayment: payment reference order mismatch', {
        reference, dbOrderId, metadataOrderId,
      });
      return res.status(400).json({ error: 'Payment reference does not match the order' });
    }

    const orderId = dbOrderId || metadataOrderId;

    if (!orderId) {
      logger.error('verifyPayment: cannot resolve orderId', { reference });
      return res.status(400).json({ error: 'Cannot identify order for this payment reference' });
    }

    const paidPesewas = Number(txData.amount);
    const currency    = txData.currency;

    // Synchronously validate amount/currency and mark the order paid so the admin
    // sees the correct state immediately — no dependency on worker polling.
    const client = await pool.connect();
    let mismatchError = null;
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        'SELECT id, status, payment_status, total_amount FROM orders WHERE id = $1 FOR UPDATE',
        [orderId]
      );
      const order = rows[0];

      if (!order) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Order not found' });
      }

      const expectedPesewas = Math.round(parseFloat(order.total_amount) * 100);

      if (currency !== 'GHS' || !Number.isFinite(paidPesewas) || paidPesewas < expectedPesewas) {
        const reason = `Payment verification mismatch (ref ${reference}): expected ${expectedPesewas} GHS pesewas, got ${paidPesewas} ${currency || 'UNKNOWN'}`;
        if (order.payment_status !== 'paid' && order.status !== 'cancelled') {
          await client.query(
            `UPDATE orders SET payment_status = 'payment_review', updated_at = NOW() WHERE id = $1`,
            [orderId]
          );
          await client.query(
            `INSERT INTO order_status_log (id, order_id, from_status, to_status, note, created_at)
             VALUES ($1, $2, $3, $3, $4, NOW())`,
            [uuid(), orderId, order.status, reason]
          );
        }
        await client.query('COMMIT');
        logger.error('verifyPayment: amount or currency mismatch', {
          orderId, reference, expectedPesewas, paidPesewas, currency,
        });
        mismatchError = 'Payment amount or currency does not match the order';
      } else if (order.payment_status !== 'paid' && order.status !== 'cancelled') {
        const needsAdvance = order.status === 'pending';
        const isOverpaid   = paidPesewas > expectedPesewas;
        const diffPesewas  = paidPesewas - expectedPesewas;

        await client.query(
          needsAdvance
            ? `UPDATE orders SET payment_status = 'paid', status = 'confirmed', updated_at = NOW() WHERE id = $1`
            : `UPDATE orders SET payment_status = 'paid', updated_at = NOW() WHERE id = $1`,
          [orderId]
        );
        await client.query(
          `UPDATE payments SET status = 'success', updated_at = NOW() WHERE paystack_reference = $1`,
          [reference]
        );
        if (needsAdvance) {
          await client.query(
            `INSERT INTO order_status_log (id, order_id, from_status, to_status, note, created_at)
             VALUES ($1, $2, $3, 'confirmed', 'Payment confirmed via Paystack', NOW())`,
            [uuid(), orderId, order.status]
          );
        }
        if (isOverpaid) {
          const note = `Overpayment flagged for review (ref ${reference}): paid ${paidPesewas} pesewas vs expected ${expectedPesewas} pesewas (+${(diffPesewas / 100).toFixed(2)} GHS)`;
          await client.query(
            `INSERT INTO order_status_log (id, order_id, from_status, to_status, note, created_at)
             VALUES ($1, $2, $3, $3, $4, NOW())`,
            [uuid(), orderId, needsAdvance ? 'confirmed' : order.status, note]
          );
          logger.warn('verifyPayment: overpayment accepted and flagged for review', {
            orderId, reference, expectedPesewas, paidPesewas, diffPesewas,
          });
        }
        await client.query('COMMIT');
      } else {
        await client.query('COMMIT');
      }
    } catch (dbErr) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error('verifyPayment: sync order update failed', { err: dbErr.message, orderId });
      throw dbErr;
    } finally {
      client.release();
    }

    if (mismatchError) {
      return res.status(400).json({ error: mismatchError });
    }

    // Enqueue for downstream work (shipment record, notification emails).
    // Worker's "already paid" branch handles the duplicate gracefully.
    const { paymentQueue } = require('../queues');
    await paymentQueue.add(
      'payment.success',
      { reference, orderId, amount: paidPesewas / 100, amountPesewas: paidPesewas, currency },
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 } }
    );

    logger.info('Payment verified and order confirmed', { reference, orderId });

    // Read order AFTER the synchronous update so the response reflects the
    // current state (confirmed/paid) rather than the pre-update state.
    const order = await OrderModel.findById(orderId);
    res.json({
      status:        'success',
      orderId,
      orderNumber:   order?.order_number  || null,
      order_status:  order?.status        || null,
      refund_status: order?.refund_status || null,
    });

  } catch (error) {
    logger.error('Payment verification error', { err: error.response?.data || error.message });
    res.status(500).json({ error: 'Failed to verify payment' });
  }
};

// ── Refund payload helpers ─────────────────────────────────────────────────────

function getRefundPayloadKey(event) {
  const data = event.data || {};
  return data.id ||
    data.refund_id ||
    data.refund_reference ||
    data.reference ||
    data.transaction_reference ||
    data.transaction?.reference ||
    data.transaction;
}

function getRefundEventId(event) {
  const key = getRefundPayloadKey(event) || 'unknown';
  const status = event.data?.status || 'unknown';
  return `paystack_${event.event}_${key}_${status}`;
}

function getRefundProviderId(data) {
  if (!data) return null;
  return data.id || data.refund_id || null;
}

function getRefundReference(data) {
  if (!data) return null;
  return data.refund_reference || data.reference || null;
}

function getTransactionReference(data) {
  if (!data) return null;
  return data.transaction_reference ||
    data.transaction?.reference ||
    (typeof data.transaction === 'string' ? data.transaction : null);
}

function getRefundFailureDetail(data) {
  if (!data) return 'Paystack refund failed';
  return data.reason ||
    data.message ||
    data.gateway_response ||
    data.status ||
    'Paystack refund failed';
}

async function findRefundOrderForUpdate(client, data) {
  const providerId = getRefundProviderId(data);
  const refundReference = getRefundReference(data);
  const transactionReference = getTransactionReference(data);

  const { rows } = await client.query(
    `SELECT o.*
       FROM orders o
      WHERE ($1::text IS NOT NULL AND o.refund_provider_id = $1)
         OR ($2::text IS NOT NULL AND o.refund_reference = $2)
         OR (
              $3::text IS NOT NULL
              AND (
                o.payment_reference = $3
                OR EXISTS (
                  SELECT 1
                    FROM payments p
                   WHERE p.order_id = o.id
                     AND p.paystack_reference = $3
                )
              )
            )
      ORDER BY
        CASE
          WHEN $1::text IS NOT NULL AND o.refund_provider_id = $1 THEN 1
          WHEN $2::text IS NOT NULL AND o.refund_reference = $2 THEN 2
          ELSE 3
        END,
        o.updated_at DESC
      LIMIT 1
      FOR UPDATE OF o`,
    [providerId ? String(providerId) : null, refundReference, transactionReference]
  );

  return rows[0] || null;
}

// ── Internal: atomically claim an event inside an open transaction ────────────
// Inserts into processed_events. Returns true when this process owns the event
// (first to commit), false when it was already committed by an earlier delivery.
// Because the INSERT is inside the caller's transaction, a concurrent process
// holding BEGIN with the same eventId will block here until the first process
// commits (conflict → returns false) or rolls back (INSERT succeeds → returns true).
async function claimEvent(client, eventId, eventType) {
  const { rowCount } = await client.query(
    'INSERT INTO processed_events (event_id, event_type) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [eventId, eventType]
  );
  return rowCount > 0;
}

// ── charge.success ─────────────────────────────────────────────────────────────
// Resolves the orderId, claims the event inside a transaction, and enqueues the
// payment.success job. Throws on any failure so the caller returns 500 and
// Paystack retries the webhook.
async function processChargeSuccess(event) {
  const txData = event.data;
  let metadata = txData.metadata;
  if (typeof metadata === 'string') { try { metadata = JSON.parse(metadata); } catch { metadata = {}; } }
  metadata = (metadata && typeof metadata === 'object') ? metadata : {};

  const metadataOrderId = metadata.orderId || metadata.order_id || null;
  const { rows: paymentRows } = await pool.query(
    'SELECT order_id FROM payments WHERE paystack_reference = $1',
    [txData.reference]
  );
  const dbOrderId = paymentRows[0]?.order_id || null;

  if (dbOrderId && metadataOrderId && String(dbOrderId) !== String(metadataOrderId)) {
    logger.error('Webhook: payment reference order mismatch for charge.success', {
      reference: txData.reference, dbOrderId, metadataOrderId,
    });
    return;
  }

  const orderId = dbOrderId || metadataOrderId;

  if (!orderId) {
    // Log and throw — caller returns 500 so Paystack retries until orderId resolves.
    logger.error('Webhook: cannot resolve orderId for charge.success', { reference: txData.reference });
    throw new Error(`Cannot resolve orderId for reference ${txData.reference}`);
  }

  const eventId = `paystack_charge_success_${txData.reference}`;
  const amountPesewas = Number(txData.amount);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const claimed = await claimEvent(client, eventId, event.event);
    if (!claimed) {
      await client.query('COMMIT');
      logger.info('Duplicate charge.success webhook skipped', { eventId });
      return;
    }

    // Enqueue the payment job. pg-boss writes to its own postgres table on a
    // separate connection. If this throws, the ROLLBACK below unclicks the claim
    // in processed_events so Paystack can retry and re-enqueue.
    const { paymentQueue } = require('../queues');
    await paymentQueue.add(
      'payment.success',
      {
        reference: txData.reference,
        orderId,
        amount: amountPesewas / 100,
        amountPesewas,
        currency: txData.currency,
      },
      { attempts: 5, backoff: { type: 'exponential', delay: 3000 } }
    );

    await client.query('COMMIT');
    logger.info('Webhook: charge.success queued', { reference: txData.reference, orderId });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── refund.processed ───────────────────────────────────────────────────────────
// Applies the refund to the order inside a single transaction that also claims
// the event. Throws on failure so the caller can return 500 for Paystack retry.
async function completePaystackRefundFromWebhook(event) {
  const eventId = getRefundEventId(event);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Claim the event atomically. Concurrent duplicates block here until the
    // first transaction commits (conflict → skip) or rolls back (→ they proceed).
    const claimed = await claimEvent(client, eventId, event.event);
    if (!claimed) {
      await client.query('COMMIT');
      logger.info('Duplicate Paystack refund webhook skipped', { eventId, event: event.event });
      return;
    }

    const order = await findRefundOrderForUpdate(client, event.data || {});
    if (!order) {
      await client.query('COMMIT');
      logger.warn('Paystack refund webhook could not be matched to an order', {
        event: event.event,
        refundProviderId: getRefundProviderId(event.data),
        refundReference: getRefundReference(event.data),
        transactionReference: getTransactionReference(event.data),
      });
      return;
    }

    // success is terminal — never overwrite it.
    if (order.refund_status === 'success') {
      await client.query('COMMIT');
      logger.info('Paystack refund webhook already applied', { eventId, orderId: order.id });
      return;
    }

    // Only advance from 'pending'.
    if (order.refund_status !== 'pending') {
      await client.query('COMMIT');
      logger.warn('Paystack refund success ignored for non-pending order', {
        eventId, orderId: order.id, refundStatus: order.refund_status,
      });
      return;
    }

    const providerId = getRefundProviderId(event.data);
    const refundReference = getRefundReference(event.data);

    await client.query(
      `UPDATE orders
          SET refund_status = 'success',
              status = 'refunded',
              payment_status = 'refunded',
              refund_provider_id = COALESCE(refund_provider_id, $1),
              refund_reference = COALESCE(refund_reference, $2),
              refunded_at = NOW(),
              updated_at = NOW()
        WHERE id = $3`,
      [providerId ? String(providerId) : null, refundReference, order.id]
    );

    await logStatusChange(
      order.id,
      order.status,
      'refunded',
      'Paystack refund processed',
      client
    );

    await client.query('COMMIT');
    logger.info('Paystack refund marked successful', { eventId, orderId: order.id });

    const { notificationQueue } = require('../queues');
    notificationQueue.add('order-refunded', { orderId: order.id })
      .catch(err => logger.error('Failed to enqueue refund notification from webhook', { err: err.message, orderId: order.id }));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── refund.failed ──────────────────────────────────────────────────────────────
// Records the refund failure inside a transaction that also claims the event.
// success is terminal — a refund.failed arriving after refund.processed is a no-op.
async function failPaystackRefundFromWebhook(event) {
  const eventId = getRefundEventId(event);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const claimed = await claimEvent(client, eventId, event.event);
    if (!claimed) {
      await client.query('COMMIT');
      logger.info('Duplicate Paystack refund webhook skipped', { eventId, event: event.event });
      return;
    }

    const order = await findRefundOrderForUpdate(client, event.data || {});
    if (!order) {
      await client.query('COMMIT');
      logger.warn('Paystack refund failure webhook could not be matched to an order', {
        event: event.event,
        refundProviderId: getRefundProviderId(event.data),
        refundReference: getRefundReference(event.data),
        transactionReference: getTransactionReference(event.data),
      });
      return;
    }

    // Never downgrade a successful refund.
    if (order.refund_status === 'success') {
      await client.query('COMMIT');
      logger.warn('Paystack refund failure ignored — refund already succeeded', {
        eventId, orderId: order.id,
      });
      return;
    }

    // Only set 'failed' from 'pending'.
    if (order.refund_status !== 'pending') {
      await client.query('COMMIT');
      logger.warn('Paystack refund failure ignored for non-pending order', {
        eventId, orderId: order.id, refundStatus: order.refund_status,
      });
      return;
    }

    const providerId = getRefundProviderId(event.data);
    const refundReference = getRefundReference(event.data);
    const failureDetail = getRefundFailureDetail(event.data);
    const refundNotes = [order.refund_notes, `Paystack refund failed: ${failureDetail}`]
      .filter(Boolean)
      .join('\n');

    await client.query(
      `UPDATE orders
          SET refund_status = 'failed',
              refund_provider_id = COALESCE(refund_provider_id, $1),
              refund_reference = COALESCE(refund_reference, $2),
              refund_notes = $3,
              updated_at = NOW()
        WHERE id = $4`,
      [providerId ? String(providerId) : null, refundReference, refundNotes, order.id]
    );

    await client.query('COMMIT');
    logger.warn('Paystack refund marked failed', {
      eventId, orderId: order.id, detail: failureDetail,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── Paystack webhook ──────────────────────────────────────────────────────────
// Flow: verify signature → process event durably → return 200.
// Any processing failure returns 500 so Paystack retries. The 200 is only sent
// after all durable DB and queue work has committed.
const handleWebhook = async (req, res) => {
  try {
    if (!Buffer.isBuffer(req.rawBody)) {
      logger.warn('Webhook rejected: missing or non-JSON raw body');
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    const signature = req.headers['x-paystack-signature'];
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!signature || typeof signature !== 'string' || !secretKey) {
      logger.warn('Webhook rejected: missing signature or key');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const expectedHex = crypto
      .createHmac('sha512', secretKey)
      .update(req.rawBody)
      .digest('hex');

    const expectedBuf = Buffer.from(expectedHex, 'hex');
    const providedBuf = /^[0-9a-f]+$/i.test(signature) ? Buffer.from(signature, 'hex') : null;

    if (!providedBuf || providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
      logger.warn('Webhook rejected: invalid signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const event = req.body;
    if (!event || typeof event !== 'object') {
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    if (REFUND_SUCCESS_EVENTS.has(event.event)) {
      await completePaystackRefundFromWebhook(event);
    } else if (REFUND_FAILED_EVENTS.has(event.event)) {
      await failPaystackRefundFromWebhook(event);
    } else if (REFUND_STATUS_EVENTS.has(event.event)) {
      // Informational only — no durable state change needed.
      logger.info('Paystack refund status webhook received', {
        event: event.event,
        refundReference: getRefundReference(event.data),
        transactionReference: getTransactionReference(event.data),
      });
    } else if (event.event === 'charge.success') {
      await processChargeSuccess(event);
    }

    // 200 is sent only after all durable work has committed.
    res.status(200).send('OK');
  } catch (err) {
    // Return 500 so Paystack retries the webhook. Do not send 200 on error.
    logger.error('Webhook processing failed', { err: err.message, event: req.body?.event });
    res.status(500).json({ error: 'Processing failed' });
  }
};

module.exports = { initializePayment, initializeGuestPayment, verifyPayment, handleWebhook };

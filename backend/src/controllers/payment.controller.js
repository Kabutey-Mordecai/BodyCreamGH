const crypto = require('crypto');
const { v4: uuid } = require('uuid');
const pool = require('../config/database');
const paystackAPI = require('../config/paystack');
const OrderModel = require('../models/order.model');
const { isProcessed, markProcessed } = require('../utils/idempotency');
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

    // Verify ownership: the email must match what was recorded at order creation.
    if (order.guest_email && order.guest_email.toLowerCase() !== email.toLowerCase()) {
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
// Called by the frontend after Paystack redirects back. Enqueues the payment
// job so it goes through the same idempotent worker path as the webhook.
const verifyPayment = async (req, res) => {
  try {
    const { reference } = req.body;
    if (!reference) return res.status(400).json({ error: 'Payment reference is required' });

    const response = await paystackAPI.get(`/transaction/verify/${reference}`);
    const txData = response.data.data;

    if (txData.status !== 'success') {
      await pool.query(
        `UPDATE payments SET status='failed', updated_at=NOW() WHERE paystack_reference=$1`,
        [reference]
      );
      return res.status(400).json({ error: 'Payment failed or not completed' });
    }

    // Resolve orderId — prefer metadata, fall back to payments table
    let metadata = txData.metadata;
    if (typeof metadata === 'string') { try { metadata = JSON.parse(metadata); } catch { metadata = {}; } }
    metadata = (metadata && typeof metadata === 'object') ? metadata : {};
    let orderId = metadata.orderId || metadata.order_id;

    if (!orderId) {
      const { rows } = await pool.query(
        'SELECT order_id FROM payments WHERE paystack_reference = $1',
        [reference]
      );
      orderId = rows[0]?.order_id;
    }

    if (!orderId) {
      logger.error('verifyPayment: cannot resolve orderId', { reference });
      return res.status(400).json({ error: 'Cannot identify order for this payment reference' });
    }

    // Enqueue — same idempotent path as the webhook
    const { paymentQueue } = require('../queues');
    await paymentQueue.add(
      'payment.success',
      { reference, orderId, amount: txData.amount / 100 },
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 } }
    );

    logger.info('Payment verified, job queued', { reference, orderId });
    const order = await OrderModel.findById(orderId);
    res.json({ status: 'success', orderId, orderNumber: order?.order_number || null });

  } catch (error) {
    logger.error('Payment verification error', { err: error.response?.data || error.message });
    res.status(500).json({ error: 'Failed to verify payment' });
  }
};

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

async function completePaystackRefundFromWebhook(event) {
  const eventId = getRefundEventId(event);
  if (await isProcessed(eventId)) {
    logger.info('Duplicate Paystack refund webhook skipped', { eventId, event: event.event });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const order = await findRefundOrderForUpdate(client, event.data || {});
    if (!order) {
      await markProcessed(eventId, event.event, client);
      await client.query('COMMIT');
      logger.warn('Paystack refund webhook could not be matched to an order', {
        event: event.event,
        refundProviderId: getRefundProviderId(event.data),
        refundReference: getRefundReference(event.data),
        transactionReference: getTransactionReference(event.data),
      });
      return;
    }

    if (order.refund_status === 'success') {
      await markProcessed(eventId, event.event, client);
      await client.query('COMMIT');
      logger.info('Paystack refund webhook already applied', { eventId, orderId: order.id });
      return;
    }

    if (order.refund_status !== 'pending') {
      await markProcessed(eventId, event.event, client);
      await client.query('COMMIT');
      logger.warn('Paystack refund success ignored for non-pending order', {
        eventId,
        orderId: order.id,
        refundStatus: order.refund_status,
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

    await markProcessed(eventId, event.event, client);
    await client.query('COMMIT');

    logger.info('Paystack refund marked successful', { eventId, orderId: order.id });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('Paystack refund success webhook failed', { err: err.message, eventId });
  } finally {
    client.release();
  }
}

async function failPaystackRefundFromWebhook(event) {
  const eventId = getRefundEventId(event);
  if (await isProcessed(eventId)) {
    logger.info('Duplicate Paystack refund webhook skipped', { eventId, event: event.event });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const order = await findRefundOrderForUpdate(client, event.data || {});
    if (!order) {
      await markProcessed(eventId, event.event, client);
      await client.query('COMMIT');
      logger.warn('Paystack refund failure webhook could not be matched to an order', {
        event: event.event,
        refundProviderId: getRefundProviderId(event.data),
        refundReference: getRefundReference(event.data),
        transactionReference: getTransactionReference(event.data),
      });
      return;
    }

    if (order.refund_status === 'success') {
      await markProcessed(eventId, event.event, client);
      await client.query('COMMIT');
      logger.warn('Paystack refund failure ignored for already refunded order', {
        eventId,
        orderId: order.id,
      });
      return;
    }

    if (order.refund_status !== 'pending') {
      await markProcessed(eventId, event.event, client);
      await client.query('COMMIT');
      logger.warn('Paystack refund failure ignored for non-pending order', {
        eventId,
        orderId: order.id,
        refundStatus: order.refund_status,
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

    await markProcessed(eventId, event.event, client);
    await client.query('COMMIT');

    logger.warn('Paystack refund marked failed', {
      eventId,
      orderId: order.id,
      detail: failureDetail,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('Paystack refund failure webhook failed', { err: err.message, eventId });
  } finally {
    client.release();
  }
}

// ── Paystack webhook ──────────────────────────────────────────────────────────
// Verify signature, respond 200 immediately, then enqueue for async processing.
const handleWebhook = async (req, res) => {
  const signature = req.headers['x-paystack-signature'];
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(req.rawBody)
    .digest('hex');

  if (hash !== signature) {
    logger.warn('Webhook rejected: invalid signature');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  // Acknowledge immediately — Paystack expects 200 within 5s
  res.status(200).send('OK');

  try {
    const event = req.body;
    if (REFUND_SUCCESS_EVENTS.has(event.event)) {
      await completePaystackRefundFromWebhook(event);
      return;
    }

    if (REFUND_FAILED_EVENTS.has(event.event)) {
      await failPaystackRefundFromWebhook(event);
      return;
    }

    if (REFUND_STATUS_EVENTS.has(event.event)) {
      logger.info('Paystack refund status webhook received', {
        event: event.event,
        refundReference: getRefundReference(event.data),
        transactionReference: getTransactionReference(event.data),
      });
      return;
    }

    if (event.event !== 'charge.success') return;

    const txData = event.data;
    let metadata = txData.metadata;
    if (typeof metadata === 'string') { try { metadata = JSON.parse(metadata); } catch { metadata = {}; } }
    metadata = (metadata && typeof metadata === 'object') ? metadata : {};

    let orderId = metadata.orderId || metadata.order_id;
    if (!orderId) {
      const { rows } = await pool.query(
        'SELECT order_id FROM payments WHERE paystack_reference = $1',
        [txData.reference]
      );
      orderId = rows[0]?.order_id;
    }

    if (!orderId) {
      logger.error('Webhook: cannot resolve orderId', { reference: txData.reference });
      return;
    }

    const { paymentQueue } = require('../queues');
    await paymentQueue.add(
      'payment.success',
      { reference: txData.reference, orderId, amount: txData.amount / 100 },
      { attempts: 5, backoff: { type: 'exponential', delay: 3000 } }
    );

    logger.info('Webhook queued', { reference: txData.reference, orderId });
  } catch (err) {
    logger.error('Webhook processing error', { err: err.message });
  }
};

module.exports = { initializePayment, initializeGuestPayment, verifyPayment, handleWebhook };

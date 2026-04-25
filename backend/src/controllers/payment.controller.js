const crypto = require('crypto');
const { v4: uuid } = require('uuid');
const pool = require('../config/database');
const paystackAPI = require('../config/paystack');
const OrderModel = require('../models/order.model');
const logger = require('../utils/logger');

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

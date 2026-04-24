const crypto = require('crypto');
const { v4: uuid } = require('uuid');
const pool = require('../config/database');
const paystackAPI = require('../config/paystack');
const OrderModel = require('../models/order.model');
const CustomerModel = require('../models/customer.model');
const { sendOrderConfirmation } = require('../services/email.service');

// Shared logic called by both /verify and the webhook
const confirmPayment = async (orderId, reference) => {
  const order = await OrderModel.findById(orderId);
  if (!order || order.payment_status === 'paid') return;

  await OrderModel.markPaid(orderId, reference);
  await pool.query(
    `UPDATE payments SET status='success', updated_at=NOW() WHERE paystack_reference=$1`,
    [reference]
  );

  // Update customer lifetime stats
  await CustomerModel.updateTotals(order.customer_id, order.total_amount);

  // Send confirmation email (non-blocking)
  const items = await OrderModel.getItems(orderId);
  sendOrderConfirmation(order.customer_email, {
    orderNumber: order.order_number,
    total: order.total_amount,
    items,
  }).catch(console.error);
};

const initializePayment = async (req, res) => {
  try {
    const { orderId } = req.body;

    const order = await OrderModel.findById(orderId, req.user.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.payment_status === 'paid') return res.status(400).json({ error: 'Order already paid' });

    const response = await paystackAPI.post('/transaction/initialize', {
      email: req.user.email,
      amount: Math.round(parseFloat(order.total_amount) * 100), // pesewas
      currency: 'GHS',
      metadata: { orderId, userId: req.user.id },
    });

    await pool.query(
      `INSERT INTO payments (id, order_id, amount, status, paystack_reference, customer_email, payment_method)
       VALUES ($1,$2,$3,'pending',$4,$5,'paystack')
       ON CONFLICT (paystack_reference) DO NOTHING`,
      [uuid(), orderId, order.total_amount, response.data.data.reference, req.user.email]
    );

    res.json({
      authorization_url: response.data.data.authorization_url,
      access_code: response.data.data.access_code,
      reference: response.data.data.reference,
    });
  } catch (error) {
    console.error('Paystack init error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to initialize payment' });
  }
};

const verifyPayment = async (req, res) => {
  try {
    const { reference } = req.body;
    if (!reference) return res.status(400).json({ error: 'Payment reference is required' });

    const response = await paystackAPI.get(`/transaction/verify/${reference}`);

    if (response.data.data.status === 'success') {
      const metadata = response.data.data.metadata || {};
      const { orderId } = metadata;
      if (!orderId) throw new Error('Missing orderId in Paystack metadata');
      await confirmPayment(orderId, reference);
      res.json({ status: 'success', orderId });
    } else {
      await pool.query(
        `UPDATE payments SET status='failed', updated_at=NOW() WHERE paystack_reference=$1`,
        [reference]
      );
      res.status(400).json({ error: 'Payment failed or not completed' });
    }
  } catch (error) {
    console.error('Payment verification error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to verify payment' });
  }
};

// Paystack signs every webhook with HMAC-SHA512 of the raw body
const handleWebhook = async (req, res) => {
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(req.rawBody)
    .digest('hex');

  if (hash !== req.headers['x-paystack-signature']) {
    return res.sendStatus(401);
  }

  try {
    const { data, event } = req.body;

    if (event === 'charge.success') {
      const { reference, metadata } = data;
      const orderId = metadata?.orderId;
      if (orderId) {
        await confirmPayment(orderId, reference);
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error);
    res.sendStatus(500);
  }
};

module.exports = { initializePayment, verifyPayment, handleWebhook };

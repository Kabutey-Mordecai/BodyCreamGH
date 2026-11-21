'use strict';

require('dotenv').config();
const assert = require('assert');
const { randomUUID: uuid } = require('crypto');

const pool = require('../src/config/database');
const OrderModel = require('../src/models/order.model');
const emailService = require('../src/services/email.service');

const shippedCalls = [];
const origSendShippingNotification = emailService.sendShippingNotification;
const origSendStatus = emailService.sendOrderStatusUpdate;
emailService.sendShippingNotification = async (to, payload) => {
  shippedCalls.push({ to, payload });
};
emailService.sendOrderStatusUpdate = async () => {};

const { updateOrderStatus } = require('../src/controllers/order.controller');
const { createDelivery } = require('../src/controllers/delivery.controller');

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    send(p) { this.body = p; return this; },
  };
}

async function createTestUser(email) {
  const id = uuid();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_active)
     VALUES ($1, $2, 'hash', 'Test', 'Buyer', 'customer', true)`,
    [id, email]
  );
  return id;
}

async function createTestOrder(customerId, { status = 'pending', paymentStatus = 'paid' } = {}) {
  const id = uuid();
  const orderNumber = `ORD-TST-${id.slice(0, 8).toUpperCase()}`;
  await pool.query(
    `INSERT INTO orders (
       id, order_number, customer_id, status, payment_status,
       discount_amount, delivery_fee, total_amount,
       fulfillment_method, shipping_address, shipping_city, shipping_region
     )
     VALUES (
       $1, $2, $3, $4, $5,
       0, 20, 120,
       'delivery', '12 Test Lane', 'Accra', 'Greater Accra'
     )`,
    [id, orderNumber, customerId, status, paymentStatus]
  );
  return { id, orderNumber };
}

async function run() {
  const createdUserIds = [];

  try {
    const email = `status-test-${Date.now()}@example.com`;
    const userId = await createTestUser(email);
    createdUserIds.push(userId);

    // 1. Direct OrderModel.updateStatus across all statuses (real Postgres, no 42P08)
    const { id: orderId1 } = await createTestOrder(userId, { status: 'pending' });
    for (const st of ['confirmed', 'processing', 'shipped']) {
      await OrderModel.updateStatus(orderId1, st);
      const { rows } = await pool.query('SELECT status, delivered_at FROM orders WHERE id = $1', [orderId1]);
      assert.strictEqual(rows[0].status, st, `Expected status=${st}`);
      assert.strictEqual(rows[0].delivered_at, null, `delivered_at must stay NULL for ${st}`);
    }

    await OrderModel.updateStatus(orderId1, 'delivered');
    const { rows: delRows1 } = await pool.query('SELECT status, delivered_at FROM orders WHERE id = $1', [orderId1]);
    assert.strictEqual(delRows1[0].status, 'delivered');
    assert(delRows1[0].delivered_at instanceof Date, 'delivered_at must be set when status=delivered');
    const firstDeliveredAt = delRows1[0].delivered_at.getTime();

    // Wait briefly and re-apply delivered; delivered_at must NOT be overwritten
    await new Promise((r) => setTimeout(r, 30));
    await OrderModel.updateStatus(orderId1, 'delivered');
    const { rows: delRows2 } = await pool.query('SELECT delivered_at FROM orders WHERE id = $1', [orderId1]);
    assert.strictEqual(
      delRows2[0].delivered_at.getTime(),
      firstDeliveredAt,
      'delivered_at must not be overwritten on repeat updateStatus(..., "delivered")'
    );

    const { id: orderIdCancel } = await createTestOrder(userId, { status: 'pending' });
    await OrderModel.updateStatus(orderIdCancel, 'cancelled');
    const { rows: cancelRows } = await pool.query('SELECT status, delivered_at FROM orders WHERE id = $1', [orderIdCancel]);
    assert.strictEqual(cancelRows[0].status, 'cancelled');
    assert.strictEqual(cancelRows[0].delivered_at, null);

    // 2. Controller path: updateOrderStatus (pending -> confirmed -> processing -> shipped -> delivered)
    const { id: orderId2 } = await createTestOrder(userId, { status: 'pending' });
    for (const st of ['confirmed', 'processing', 'shipped', 'delivered']) {
      const req = { params: { orderId: orderId2 }, body: { status: st, note: `test-${st}` } };
      const res = makeRes();
      await updateOrderStatus(req, res);
      assert.strictEqual(res.statusCode, 200, `updateOrderStatus(${st}) failed: ${JSON.stringify(res.body)}`);
    }
    const { rows: logRows2 } = await pool.query(
      'SELECT to_status FROM order_status_log WHERE order_id = $1 ORDER BY created_at ASC',
      [orderId2]
    );
    assert.deepStrictEqual(
      logRows2.map((r) => r.to_status),
      ['confirmed', 'processing', 'shipped', 'delivered']
    );
    const { rows: ord2After } = await pool.query('SELECT status, delivered_at FROM orders WHERE id = $1', [orderId2]);
    assert.strictEqual(ord2After[0].status, 'delivered');
    assert(ord2After[0].delivered_at instanceof Date);

    // 3. Controller path: POST /api/deliveries (createDelivery) with explicit tracking_number
    const { id: orderWithTrack, orderNumber: orderNumWithTrack } = await createTestOrder(userId, { status: 'processing' });
    const explicitTracking = `TRK-TEST-${Date.now()}`;
    shippedCalls.length = 0;
    {
      const req = {
        body: {
          order_id: orderWithTrack,
          courier_name: 'Manual Dispatch',
          tracking_number: explicitTracking,
          delivery_fee: 20,
          notes: 'With tracking',
        },
      };
      const res = makeRes();
      await createDelivery(req, res);
      assert.strictEqual(res.statusCode, 201, `createDelivery failed: ${JSON.stringify(res.body)}`);
      const { rows: delivRows } = await pool.query('SELECT tracking_number FROM deliveries WHERE order_id = $1', [orderWithTrack]);
      assert.strictEqual(delivRows.length, 1);
      assert.strictEqual(delivRows[0].tracking_number, explicitTracking);

      const { rows: ordRows } = await pool.query('SELECT status FROM orders WHERE id = $1', [orderWithTrack]);
      assert.strictEqual(ordRows[0].status, 'shipped');

      const { rows: logRows } = await pool.query(
        'SELECT from_status, to_status FROM order_status_log WHERE order_id = $1',
        [orderWithTrack]
      );
      assert.strictEqual(logRows.length, 1);
      assert.strictEqual(logRows[0].from_status, 'processing');
      assert.strictEqual(logRows[0].to_status, 'shipped');

      assert.strictEqual(shippedCalls.length, 1, 'sendShippingNotification must be called once');
      assert.strictEqual(shippedCalls[0].to, email);
      assert.strictEqual(shippedCalls[0].payload.orderNumber, orderNumWithTrack);
      assert.strictEqual(shippedCalls[0].payload.trackingNumber, explicitTracking);
    }

    // 4. Controller path: POST /api/deliveries without explicit tracking_number auto-generates TRK-... before sending email
    const { id: orderAutoTrack } = await createTestOrder(userId, { status: 'processing' });
    shippedCalls.length = 0;
    {
      const req = {
        body: {
          order_id: orderAutoTrack,
          courier_name: 'Manual Dispatch',
          delivery_fee: 20,
          notes: 'Auto tracking',
        },
      };
      const res = makeRes();
      await createDelivery(req, res);
      assert.strictEqual(res.statusCode, 201, `createDelivery auto tracking failed: ${JSON.stringify(res.body)}`);
      const { rows: delivRows } = await pool.query('SELECT tracking_number FROM deliveries WHERE order_id = $1', [orderAutoTrack]);
      assert.strictEqual(delivRows.length, 1);
      assert(/^TRK-\d{8}-[A-F0-9]{6}$/.test(delivRows[0].tracking_number), `Expected auto-generated TRK-..., got ${delivRows[0].tracking_number}`);
      assert.strictEqual(shippedCalls.length, 1);
      assert.strictEqual(shippedCalls[0].payload.trackingNumber, delivRows[0].tracking_number);
    }

    console.log('[PASS] OrderModel.updateStatus & POST /api/deliveries real-Postgres regression tests passed.');
  } finally {
    emailService.sendShippingNotification = origSendShippingNotification;
    emailService.sendOrderStatusUpdate = origSendStatus;
    if (createdUserIds.length) {
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [createdUserIds]).catch(() => {});
    }
    await pool.end();
  }
}

run().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});

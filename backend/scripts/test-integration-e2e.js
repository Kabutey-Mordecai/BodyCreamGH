'use strict';

require('dotenv').config();
const assert = require('assert');
const { randomUUID: uuid } = require('crypto');

const testUrl = (process.env.TEST_DATABASE_URL || '').trim();
if (!testUrl) {
  console.error('[FATAL] TEST_DATABASE_URL must be set');
  process.exit(1);
}
process.env.DATABASE_URL = testUrl;

const pool = require('../src/config/database');
const OrderModel = require('../src/models/order.model');
const { createOrder, createGuestOrder } = require('../src/controllers/order.controller');
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

async function main() {
  const userId = uuid();
  const prodId = uuid();
  const createdOrderIds = [];

  let prevGuestSetting = null;
  try {
    const prevSet = await pool.query(`SELECT value FROM site_settings WHERE key = 'guest_checkout_enabled'`);
    prevGuestSetting = prevSet.rows[0] ? prevSet.rows[0].value : null;
    await pool.query(
      `INSERT INTO site_settings (key, value) VALUES ('guest_checkout_enabled', 'true'::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = 'true'::jsonb`
    );

    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_active)
       VALUES ($1, $2, 'hash', 'Int', 'Buyer', 'customer', TRUE)`,
      [userId, `int-${Date.now()}@example.com`]
    );
    await pool.query(
      `INSERT INTO products (id, name, price, stock_quantity, is_active)
       VALUES ($1, 'Integration Shea Cream', 75.00, 20, TRUE)`,
      [prodId]
    );
    await pool.query(
      `INSERT INTO cart_items (id, customer_id, product_id, quantity) VALUES ($1, $2, $3, 2)`,
      [uuid(), userId, prodId]
    );

    // 1. Authenticated createOrder with ghana_post_gps + delivery_landmark (real Postgres)
    const rAuth = makeRes();
    await createOrder(
      {
        user: { id: userId },
        body: {
          fulfillment_method: 'delivery',
          payment_method: 'paystack',
          shipping_address: '14 Independence Ave',
          shipping_city: 'Accra',
          shipping_region: 'Greater Accra',
          ghana_post_gps: 'ga-183-9024',
          delivery_landmark: 'Near Independence Arch',
        },
      },
      rAuth
    );
    assert.strictEqual(rAuth.statusCode, 201, `createOrder failed: ${JSON.stringify(rAuth.body)}`);
    createdOrderIds.push(rAuth.body.orderId);

    const authOrdRow = await pool.query(
      `SELECT ghana_post_gps, delivery_landmark FROM orders WHERE id = $1`,
      [rAuth.body.orderId]
    );
    assert.strictEqual(authOrdRow.rows[0].ghana_post_gps, 'GA-183-9024');
    assert.strictEqual(authOrdRow.rows[0].delivery_landmark, 'Near Independence Arch');

    // 2. Guest createGuestOrder with ghana_post_gps + delivery_landmark (real Postgres)
    const rGuest = makeRes();
    await createGuestOrder(
      {
        body: {
          email: `guest-int-${Date.now()}@example.com`,
          first_name: 'Kofi',
          last_name: 'Mensah',
          phone: '+233240001122',
          fulfillment_method: 'delivery',
          payment_method: 'paystack',
          shipping_address: '22 Ring Road',
          shipping_city: 'Accra',
          shipping_region: 'Greater Accra',
          ghana_post_gps: 'GA-456-7890',
          delivery_landmark: 'Blue gate beside pharmacy',
          items: [{ product_id: prodId, quantity: 1 }],
        },
      },
      rGuest
    );
    assert.strictEqual(rGuest.statusCode, 201, `createGuestOrder failed: ${JSON.stringify(rGuest.body)}`);
    createdOrderIds.push(rGuest.body.orderId);

    const guestOrdRow = await pool.query(
      `SELECT ghana_post_gps, delivery_landmark FROM orders WHERE id = $1`,
      [rGuest.body.orderId]
    );
    assert.strictEqual(guestOrdRow.rows[0].ghana_post_gps, 'GA-456-7890');
    assert.strictEqual(guestOrdRow.rows[0].delivery_landmark, 'Blue gate beside pharmacy');

    // 3. OrderModel.updateStatus through confirmed/processing/shipped/delivered/cancelled
    for (const st of ['confirmed', 'processing', 'shipped', 'delivered', 'cancelled']) {
      await OrderModel.updateStatus(rGuest.body.orderId, st);
      const r = await pool.query(`SELECT status FROM orders WHERE id = $1`, [rGuest.body.orderId]);
      assert.strictEqual(r.rows[0].status, st);
    }

    // 4. POST /api/deliveries (createDelivery) on real Postgres
    const rDel = makeRes();
    await createDelivery(
      {
        body: {
          order_id: rAuth.body.orderId,
          delivery_partner: 'Speedaf GH',
          tracking_number: `TRK-INT-${Date.now()}`,
        },
      },
      rDel
    );
    assert.strictEqual(rDel.statusCode, 201, `createDelivery failed: ${JSON.stringify(rDel.body)}`);
    const delRow = await pool.query(`SELECT delivery_partner FROM deliveries WHERE order_id = $1`, [rAuth.body.orderId]);
    assert.strictEqual(delRow.rows[0].delivery_partner, 'Speedaf GH');

    console.log('ALL REAL-DB INTEGRATION TESTS PASSED (createOrder, createGuestOrder, updateStatus, createDelivery)');
  } finally {
    if (prevGuestSetting === null) {
      await pool.query(`DELETE FROM site_settings WHERE key = 'guest_checkout_enabled'`).catch(() => {});
    } else {
      await pool.query(
        `UPDATE site_settings SET value = $1 WHERE key = 'guest_checkout_enabled'`,
        [JSON.stringify(prevGuestSetting)]
      ).catch(() => {});
    }
    await pool.query(`DELETE FROM deliveries WHERE order_id = ANY($1::uuid[])`, [createdOrderIds]).catch(() => {});
    await pool.query(`DELETE FROM order_status_log WHERE order_id = ANY($1::uuid[])`, [createdOrderIds]).catch(() => {});
    await pool.query(`DELETE FROM order_items WHERE order_id = ANY($1::uuid[])`, [createdOrderIds]).catch(() => {});
    await pool.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [createdOrderIds]).catch(() => {});
    await pool.query(`DELETE FROM inventory_logs WHERE product_id = $1`, [prodId]).catch(() => {});
    await pool.query(`DELETE FROM cart_items WHERE customer_id = $1`, [userId]).catch(() => {});
    await pool.query(`DELETE FROM products WHERE id = $1`, [prodId]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => {});
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

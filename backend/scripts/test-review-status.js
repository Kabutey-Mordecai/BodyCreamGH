'use strict';

require('dotenv').config();
const assert = require('assert');
const { randomUUID: uuid } = require('crypto');

const pool = require('../src/config/database');
const ReviewModel = require('../src/models/review.model');
const { getReviewStatus } = require('../src/controllers/order.controller');

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
  };
}

async function run() {
  const userId = uuid();
  const product1Id = uuid();
  const product2Id = uuid();
  const orderId = uuid();
  const ts = Date.now();

  try {
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_active)
       VALUES ($1, $2, 'hash', 'Review', 'Tester', 'customer', true)`,
      [userId, `review-status-${ts}@example.com`]
    );

    await pool.query(
      `INSERT INTO products (id, name, price, stock_quantity, is_active)
       VALUES
         ($1, 'Review Test Cream A', 50.00, 10, true),
         ($2, 'Review Test Cream B', 60.00, 10, true)`,
      [product1Id, product2Id]
    );

    await pool.query(
      `INSERT INTO orders (
         id, order_number, customer_id, status, payment_status,
         discount_amount, delivery_fee, total_amount, fulfillment_method, delivered_at
       )
       VALUES ($1, $2, $3, 'delivered', 'paid', 0, 0, 110.00, 'delivery', NOW())`,
      [orderId, `ORD-REV-${ts.toString().slice(-6)}`, userId]
    );

    await pool.query(
      `INSERT INTO order_items (id, order_id, product_id, quantity, price_at_purchase, subtotal)
       VALUES
         ($1, $3, $4, 1, 50.00, 50.00),
         ($2, $3, $5, 1, 60.00, 60.00)`,
      [uuid(), uuid(), orderId, product1Id, product2Id]
    );

    // 1. Zero products reviewed
    assert.strictEqual(await ReviewModel.findByUser(userId, product1Id), null);
    {
      const res = makeRes();
      await getReviewStatus({ params: { orderId }, user: { id: userId } }, res);
      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.body.reviewed, [], 'Expected empty reviewed list when 0 products reviewed');
    }

    // 2. One product reviewed
    await pool.query(
      `INSERT INTO product_reviews (id, product_id, user_id, rating, title, body, is_approved)
       VALUES ($1, $2, $3, 5, 'Great', 'Smooth texture', true)`,
      [uuid(), product1Id, userId]
    );
    const foundOne = await ReviewModel.findByUser(userId, product1Id);
    assert(foundOne && foundOne.product_id === product1Id);
    assert.strictEqual(await ReviewModel.findByUser(userId, product2Id), null);
    {
      const res = makeRes();
      await getReviewStatus({ params: { orderId }, user: { id: userId } }, res);
      assert.strictEqual(res.statusCode, 200);
      assert.deepStrictEqual(res.body.reviewed, [product1Id]);
    }

    // 3. All products reviewed
    await pool.query(
      `INSERT INTO product_reviews (id, product_id, user_id, rating, title, body, is_approved)
       VALUES ($1, $2, $3, 4, 'Nice', 'Lovely scent', true)`,
      [uuid(), product2Id, userId]
    );
    {
      const res = makeRes();
      await getReviewStatus({ params: { orderId }, user: { id: userId } }, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.reviewed.length, 2);
      assert(res.body.reviewed.includes(product1Id));
      assert(res.body.reviewed.includes(product2Id));
    }

    console.log('[PASS] ReviewModel.findByUser & GET /api/orders/:orderId/review-status tests passed.');
  } finally {
    await pool.query('DELETE FROM product_reviews WHERE user_id = $1', [userId]).catch(() => {});
    await pool.query('DELETE FROM order_items WHERE order_id = $1', [orderId]).catch(() => {});
    await pool.query('DELETE FROM orders WHERE id = $1', [orderId]).catch(() => {});
    await pool.query('DELETE FROM products WHERE id = ANY($1::uuid[])', [[product1Id, product2Id]]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
    await pool.end();
  }
}

run().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});

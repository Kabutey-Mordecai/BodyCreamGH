'use strict';

require('dotenv').config();
const assert = require('assert');
const { randomUUID: uuid } = require('crypto');
const pool = require('../src/config/database');
const { generateOrderNumber, insertOrderWithUniqueNumber } = require('../src/utils/orderNumber');
const { trackOrder } = require('../src/controllers/order.controller');

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
  };
}

async function run() {
  // 1. Format & uniqueness check
  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    const num = generateOrderNumber();
    assert(/^ORD-[A-Z2-7]{8}$/.test(num), `Invalid order number format: ${num}`);
    seen.add(num);
  }
  assert.strictEqual(seen.size, 1000, `Expected 1000 unique order numbers, got ${seen.size}`);

  // 2. Real PG 23505 unique-constraint collision retry inside a transaction
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existingId = uuid();
    const collidingCode = generateOrderNumber();
    const freshCode = generateOrderNumber();

    await client.query(
      `INSERT INTO orders (id, order_number, total_amount, status, payment_status, fulfillment_method, payment_method)
       VALUES ($1, $2, 10.00, 'pending', 'unpaid', 'delivery', 'paystack')`,
      [existingId, collidingCode]
    );

    let attempts = 0;
    const sequence = [collidingCode, collidingCode, freshCode];
    const secondId = uuid();
    const insertedNumber = await insertOrderWithUniqueNumber(
      client,
      async (candidate) => {
        await client.query(
          `INSERT INTO orders (id, order_number, total_amount, status, payment_status, fulfillment_method, payment_method)
           VALUES ($1, $2, 20.00, 'pending', 'unpaid', 'delivery', 'paystack')`,
          [secondId, candidate]
        );
      },
      {
        maxAttempts: 5,
        generator: () => sequence[attempts++],
      }
    );

    assert.strictEqual(attempts, 3, `Expected 3 attempts (2 collisions + 1 success), got ${attempts}`);
    assert.strictEqual(insertedNumber, freshCode, 'Expected inserted order number to match freshCode');

    // Verify both rows exist inside the transaction before rollback
    const { rows } = await client.query(
      'SELECT order_number FROM orders WHERE id IN ($1, $2)',
      [existingId, secondId]
    );
    assert.strictEqual(rows.length, 2, 'Expected both rows present after SAVEPOINT collision recovery');
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }

  // 3. Old-format ORD-<timestamp> lookup via trackOrder still works alongside new format
  const { rows: oldRows } = await pool.query(
    `SELECT o.order_number, COALESCE(u.email, o.guest_email) AS email
       FROM orders o
       LEFT JOIN users u ON o.customer_id = u.id
      WHERE o.order_number ~ '^ORD-[0-9]{10,}$'
        AND COALESCE(u.email, o.guest_email) IS NOT NULL
      LIMIT 1`
  );
  if (oldRows.length > 0) {
    const res = makeRes();
    await trackOrder(
      { body: { order_number: oldRows[0].order_number, email: oldRows[0].email } },
      res
    );
    assert.strictEqual(res.statusCode, 200, `Expected 200 for legacy order lookup, got ${res.statusCode}`);
    assert.strictEqual(res.body.order_number, oldRows[0].order_number);
  }

  console.log('ALL ORDER NUMBER GENERATION & COLLISION RETRY TESTS PASSED');
  await pool.end();
}

run().catch(async (err) => {
  console.error('TEST FAILED:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});

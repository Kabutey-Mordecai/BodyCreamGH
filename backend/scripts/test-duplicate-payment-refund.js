'use strict';

require('dotenv').config();
const assert = require('assert');
const { randomUUID: uuid } = require('crypto');
const pool = require('../src/config/database');
const paystackAPI = require('../src/config/paystack');
const { refundDuplicatePayment } = require('../src/controllers/order.controller');

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
  };
}

async function run() {
  const originalAdapter = paystackAPI.defaults.adapter;
  const orderId = uuid();
  const winPaymentId = uuid();
  const dupPaymentId = uuid();
  const orderNumber = `ORD-DUPTEST1`;
  const winRef = `test_win_${Date.now()}`;
  const dupRef = `test_dup_${Date.now()}`;

  try {
    await pool.query(
      `INSERT INTO orders (id, order_number, total_amount, status, payment_status, payment_reference, fulfillment_method, payment_method)
       VALUES ($1, $2, 150.00, 'confirmed', 'paid', $3, 'delivery', 'paystack')`,
      [orderId, orderNumber, winRef]
    );
    await pool.query(
      `INSERT INTO payments (id, order_id, amount, currency, status, payment_method, paystack_reference)
       VALUES ($1, $2, 150.00, 'GHS', 'success', 'paystack', $3),
              ($4, $2, 150.00, 'GHS', 'duplicate', 'paystack', $5)`,
      [winPaymentId, orderId, winRef, dupPaymentId, dupRef]
    );

    // 1. Attempting to refund the winning 'success' payment must be rejected with 400
    const resWin = makeRes();
    await refundDuplicatePayment(
      { params: { orderId, paymentId: winPaymentId }, body: {} },
      resWin
    );
    assert.strictEqual(resWin.statusCode, 400, `Expected 400 for non-duplicate payment, got ${resWin.statusCode}`);

    // 2. Stub Paystack /refund to succeed and refund the 'duplicate' row
    let capturedPayload = null;
    paystackAPI.defaults.adapter = async (config) => {
      capturedPayload = JSON.parse(config.data);
      return {
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
        data: { status: true, data: { id: 999001, status: 'pending', transaction: { reference: dupRef } } },
      };
    };

    const resDup = makeRes();
    await refundDuplicatePayment(
      { params: { orderId, paymentId: dupPaymentId }, body: { notes: 'Double charge verified' } },
      resDup
    );
    assert.strictEqual(resDup.statusCode, 200, `Expected 200 for duplicate refund, got ${resDup.statusCode}: ${JSON.stringify(resDup.body)}`);
    assert.strictEqual(capturedPayload.transaction, dupRef);
    assert.strictEqual(capturedPayload.amount, 15000);

    // Verify DB state: duplicate row -> 'refunded', winning row -> 'success', order -> still 'paid'
    const { rows: payRows } = await pool.query(
      'SELECT id, status FROM payments WHERE order_id = $1',
      [orderId]
    );
    const byId = Object.fromEntries(payRows.map(r => [r.id, r.status]));
    assert.strictEqual(byId[dupPaymentId], 'refunded');
    assert.strictEqual(byId[winPaymentId], 'success');

    const { rows: ordRows } = await pool.query('SELECT payment_status FROM orders WHERE id = $1', [orderId]);
    assert.strictEqual(ordRows[0].payment_status, 'paid');

    const { rows: logRows } = await pool.query(
      'SELECT note FROM order_status_log WHERE order_id = $1',
      [orderId]
    );
    assert(logRows.some(r => r.note.includes(dupRef)), 'Expected audit log entry for duplicate refund');

    console.log('ALL DUPLICATE PAYMENT REFUND TESTS PASSED');
  } finally {
    paystackAPI.defaults.adapter = originalAdapter;
    await pool.query('DELETE FROM order_status_log WHERE order_id = $1', [orderId]).catch(() => {});
    await pool.query('DELETE FROM payments WHERE order_id = $1', [orderId]).catch(() => {});
    await pool.query('DELETE FROM orders WHERE id = $1', [orderId]).catch(() => {});
    await pool.end();
  }
}

run().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});

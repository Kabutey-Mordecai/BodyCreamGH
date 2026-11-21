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
  const retryDupPaymentId = uuid();
  const orderNumber = 'ORD-DUPTEST1';
  const winRef = `test_win_${Date.now()}`;
  const dupRef = `test_dup_${Date.now()}`;
  const retryDupRef = `test_dup_retry_${Date.now()}`;

  try {
    await pool.query(
      `INSERT INTO orders (id, order_number, total_amount, status, payment_status, payment_reference, fulfillment_method, payment_method)
       VALUES ($1, $2, 150.00, 'confirmed', 'paid', $3, 'delivery', 'paystack')`,
      [orderId, orderNumber, winRef]
    );
    await pool.query(
      `INSERT INTO payments (id, order_id, amount, currency, status, payment_method, paystack_reference)
       VALUES ($1, $2, 150.00, 'GHS', 'success', 'paystack', $3),
              ($4, $2, 150.00, 'GHS', 'duplicate', 'paystack', $5),
              ($6, $2, 150.00, 'GHS', 'duplicate', 'paystack', $7)`,
      [winPaymentId, orderId, winRef, dupPaymentId, dupRef, retryDupPaymentId, retryDupRef]
    );

    // 1. Attempting to refund the winning 'success' payment must be rejected with 400
    const resWin = makeRes();
    await refundDuplicatePayment(
      { params: { orderId, paymentId: winPaymentId }, body: {} },
      resWin
    );
    assert.strictEqual(resWin.statusCode, 400, `Expected 400 for non-duplicate payment, got ${resWin.statusCode}`);

    // 2. Stub Paystack GET /refund (none existing) + POST /refund and verify ONLY dupRef is refunded (never winRef)
    let capturedPayload = null;
    let postRefundCalls = 0;
    paystackAPI.defaults.adapter = async (config) => {
      if (config.method === 'get' && config.url === '/refund') {
        assert.strictEqual(config.params?.reference, dupRef, 'Lookup must query the duplicate reference, not the winning reference');
        return { status: 200, statusText: 'OK', headers: {}, config, data: { status: true, data: [] } };
      }
      if (config.method === 'post' && config.url === '/refund') {
        postRefundCalls++;
        capturedPayload = JSON.parse(config.data);
        return {
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
          data: { status: true, data: { id: 999001, status: 'pending', transaction: { reference: dupRef } } },
        };
      }
      throw new Error(`Unexpected Paystack call: ${config.method} ${config.url}`);
    };

    const resDup = makeRes();
    await refundDuplicatePayment(
      { params: { orderId, paymentId: dupPaymentId }, body: { notes: 'Double charge verified' } },
      resDup
    );
    assert.strictEqual(resDup.statusCode, 200, `Expected 200 for duplicate refund, got ${resDup.statusCode}: ${JSON.stringify(resDup.body)}`);
    assert.strictEqual(postRefundCalls, 1, 'Expected exactly 1 POST /refund call');
    assert.strictEqual(capturedPayload.transaction, dupRef, 'Must refund the duplicate payment reference');
    assert.notStrictEqual(capturedPayload.transaction, winRef, 'Must NEVER refund the winning payment reference');
    assert.strictEqual(capturedPayload.amount, 15000);

    // 3. Retry idempotency: simulate prior Paystack refund succeeded (exists on GET /refund)
    //    but local DB row stayed 'duplicate' due to earlier DB failure -> retry must NOT call POST /refund again
    let retryPostCalls = 0;
    paystackAPI.defaults.adapter = async (config) => {
      if (config.method === 'get' && config.url === '/refund') {
        assert.strictEqual(config.params?.reference, retryDupRef);
        return {
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
          data: { status: true, data: [{ id: 999002, status: 'processed', reference: 'rf_already_done' }] },
        };
      }
      if (config.method === 'post' && config.url === '/refund') {
        retryPostCalls++;
        throw new Error('DOUBLE REFUND BUG: POST /refund must not be called when Paystack already has an active refund');
      }
      throw new Error(`Unexpected Paystack call: ${config.method} ${config.url}`);
    };

    const resRetry = makeRes();
    await refundDuplicatePayment(
      { params: { orderId, paymentId: retryDupPaymentId }, body: {} },
      resRetry
    );
    assert.strictEqual(resRetry.statusCode, 200, `Expected 200 on idempotent retry, got ${resRetry.statusCode}`);
    assert.strictEqual(retryPostCalls, 0, 'POST /refund must not be called on retry when refund already exists');
    assert.strictEqual(resRetry.body.already_refunded_on_paystack, true);

    // Verify DB state: both duplicate rows -> 'refunded', winning row -> 'success', order -> still 'paid'
    const { rows: payRows } = await pool.query(
      'SELECT id, status FROM payments WHERE order_id = $1',
      [orderId]
    );
    const byId = Object.fromEntries(payRows.map(r => [r.id, r.status]));
    assert.strictEqual(byId[dupPaymentId], 'refunded');
    assert.strictEqual(byId[retryDupPaymentId], 'refunded');
    assert.strictEqual(byId[winPaymentId], 'success');

    const { rows: ordRows } = await pool.query('SELECT payment_status FROM orders WHERE id = $1', [orderId]);
    assert.strictEqual(ordRows[0].payment_status, 'paid');

    const { rows: logRows } = await pool.query(
      'SELECT note FROM order_status_log WHERE order_id = $1',
      [orderId]
    );
    assert(logRows.some(r => r.note.includes(dupRef)), 'Expected audit log entry for duplicate refund');
    assert(logRows.some(r => r.note.includes(retryDupRef)), 'Expected audit log entry for reconciled duplicate refund');

    console.log('ALL DUPLICATE PAYMENT REFUND TESTS PASSED (two-ref isolation + no double-refund on retry)');
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

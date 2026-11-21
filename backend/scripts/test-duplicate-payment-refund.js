'use strict';

require('dotenv').config();
const assert = require('assert');
const { randomUUID: uuid } = require('crypto');
const pool = require('../src/config/database');
const paystackAPI = require('../src/config/paystack');
const { refundDuplicatePayment } = require('../src/controllers/order.controller');
const { reconcileDuplicatePaymentRefunds } = require('../src/workers/refund.reconciliation.worker');

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
  const failReconcilePaymentId = uuid();
  const retryDupPaymentId = uuid();
  const orderNumber = 'ORD-DUPTEST1';
  const winRef = `test_win_${Date.now()}`;
  const dupRef = `test_dup_${Date.now()}`;
  const failRecRef = `test_dup_failrec_${Date.now()}`;
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
              ($6, $2, 150.00, 'GHS', 'duplicate', 'paystack', $7),
              ($8, $2, 150.00, 'GHS', 'duplicate', 'paystack', $9)`,
      [
        winPaymentId, orderId, winRef,
        dupPaymentId, dupRef,
        failReconcilePaymentId, failRecRef,
        retryDupPaymentId, retryDupRef,
      ]
    );

    // 1. Attempting to refund the winning 'success' payment must be rejected with 400
    const resWin = makeRes();
    await refundDuplicatePayment(
      { params: { orderId, paymentId: winPaymentId }, body: {} },
      resWin
    );
    assert.strictEqual(resWin.statusCode, 400, `Expected 400 for non-duplicate payment, got ${resWin.statusCode}`);

    // 2. If fetchRefundsByTransaction throws, abort with 502 and NEVER call POST /refund
    let postCalledOnLookupError = false;
    paystackAPI.defaults.adapter = async (config) => {
      if (config.method === 'get' && config.url === '/refund') {
        throw new Error('Simulated Paystack GET /refund timeout');
      }
      if (config.method === 'post' && config.url === '/refund') {
        postCalledOnLookupError = true;
      }
      throw new Error(`Unexpected call: ${config.method} ${config.url}`);
    };
    const resLookupErr = makeRes();
    await refundDuplicatePayment(
      { params: { orderId, paymentId: dupPaymentId }, body: {} },
      resLookupErr
    );
    assert.strictEqual(resLookupErr.statusCode, 502, `Expected 502 on lookup failure, got ${resLookupErr.statusCode}`);
    assert.strictEqual(postCalledOnLookupError, false, 'POST /refund must NOT be called when lookup fails');
    const { rows: afterLookupErr } = await pool.query('SELECT status FROM payments WHERE id = $1', [dupPaymentId]);
    assert.strictEqual(afterLookupErr[0].status, 'duplicate', 'Payment must remain duplicate after lookup failure');

    // 3. Prior 'failed' refund does NOT block retry; Paystack 'pending' response sets 'refund_pending' (NOT 'refunded')
    const ALLOWED_POST_REFUND_KEYS = new Set(['transaction', 'amount', 'currency', 'customer_note', 'merchant_note']);
    let capturedPayload = null;
    let postRefundCalls = 0;
    paystackAPI.defaults.adapter = async (config) => {
      if (config.method === 'get' && config.url === '/refund') {
        assert.strictEqual(config.params?.reference, dupRef, 'Lookup must query dupRef, not winRef');
        return {
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
          data: { status: true, data: [{ id: 888000, status: 'failed', amount: 15000, currency: 'GHS', merchant_note: 'Prior failed', customer_note: '' }] },
        };
      }
      if (config.method === 'post' && config.url === '/refund') {
        postRefundCalls++;
        capturedPayload = JSON.parse(config.data);
        assert(!('reference' in capturedPayload), 'POST /refund must NOT send undocumented reference key');
        for (const k of Object.keys(capturedPayload)) {
          assert(ALLOWED_POST_REFUND_KEYS.has(k), `Undocumented POST /refund key: ${k}`);
        }
        return {
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
          data: {
            status: true,
            data: {
              id: 999001,
              status: 'pending',
              amount: capturedPayload.amount,
              currency: capturedPayload.currency || 'GHS',
              merchant_note: capturedPayload.merchant_note || '',
              customer_note: '',
            },
          },
        };
      }
      throw new Error(`Unexpected Paystack call: ${config.method} ${config.url}`);
    };

    const resDup = makeRes();
    await refundDuplicatePayment(
      { params: { orderId, paymentId: dupPaymentId }, body: { notes: 'Double charge verified' } },
      resDup
    );
    assert.strictEqual(resDup.statusCode, 200, `Expected 200 for duplicate refund, got ${resDup.statusCode}`);
    assert.strictEqual(postRefundCalls, 1);
    assert.strictEqual(capturedPayload.transaction, dupRef, 'Must refund the duplicate payment reference');
    assert.notStrictEqual(capturedPayload.transaction, winRef, 'Must NEVER refund the winning payment reference');
    assert.strictEqual(capturedPayload.amount, 15000);
    assert.strictEqual(resDup.body.payment.status, 'refund_pending', 'Pending Paystack refund must store status=refund_pending, not refunded');

    // 4. Put failReconcilePaymentId into 'refund_pending' too, and add a stale (>48h) refund_pending row
    //    - dupRef reports 'processed' -> moves to 'refunded'
    //    - failRecRef reports 'failed' -> reverts to 'duplicate' + alerts admin (with singletonKey)
    //    - staleRef (>48h old, still pending) -> alerts admin with dup_refund_stale_48h_* & singletonKey
    const stalePaymentId = uuid();
    const staleRef = `test_dup_stale_${Date.now()}`;
    await pool.query(`UPDATE payments SET status = 'refund_pending' WHERE id = $1`, [failReconcilePaymentId]);
    await pool.query(
      `INSERT INTO payments (id, order_id, amount, currency, status, payment_method, paystack_reference, updated_at)
       VALUES ($1, $2, 150.00, 'GHS', 'refund_pending', 'paystack', $3, NOW() - INTERVAL '49 hours')`,
      [stalePaymentId, orderId, staleRef]
    );

    const sentAlerts = [];
    const mockBoss = {
      send: async (queue, data, opts) => {
        sentAlerts.push({ queue, data, opts });
      },
    };

    paystackAPI.defaults.adapter = async (config) => {
      if (config.method === 'get' && config.url === '/refund') {
        if (config.params?.reference === dupRef) {
          return { status: 200, statusText: 'OK', headers: {}, config, data: { status: true, data: [{ id: 999001, status: 'processed' }] } };
        }
        if (config.params?.reference === failRecRef) {
          return { status: 200, statusText: 'OK', headers: {}, config, data: { status: true, data: [{ id: 999003, status: 'failed' }] } };
        }
        if (config.params?.reference === staleRef) {
          return { status: 200, statusText: 'OK', headers: {}, config, data: { status: true, data: [{ id: 999004, status: 'pending' }] } };
        }
      }
      throw new Error(`Unexpected Paystack call during reconcile: ${config.method} ${config.url}`);
    };

    const recStats = await reconcileDuplicatePaymentRefunds(mockBoss);
    assert(recStats.refunded >= 1, 'Expected at least 1 refund_pending row marked refunded');
    assert(recStats.reverted >= 1, 'Expected at least 1 failed refund_pending row reverted to duplicate');
    assert(recStats.staleAlerted >= 1, 'Expected at least 1 stale >48h refund_pending alert');
    assert(
      sentAlerts.some(a => a.queue === 'notification/admin-payment-alert' && a.data.orderId === orderId && a.data.detail.includes(failRecRef) && a.opts?.singletonKey === a.data.alertKey),
      'Expected admin-payment-alert with singletonKey when duplicate refund fails during reconciliation'
    );
    assert(
      sentAlerts.some(a => a.queue === 'notification/admin-payment-alert' && a.data.alertKey === `dup_refund_stale_48h_${staleRef}` && a.opts?.singletonKey === a.data.alertKey),
      'Expected stale >48h admin-payment-alert with singletonKey'
    );

    // 5. Retry idempotency: prior Paystack 'processed' refund skips POST /refund and marks 'refunded'
    let retryPostCalls = 0;
    paystackAPI.defaults.adapter = async (config) => {
      if (config.method === 'get' && config.url === '/refund') {
        assert.strictEqual(config.params?.reference, retryDupRef);
        return {
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
          data: { status: true, data: [{ id: 999002, status: 'processed', amount: 15000, currency: 'GHS', merchant_note: '', customer_note: '' }] },
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
    assert.strictEqual(resRetry.statusCode, 200);
    assert.strictEqual(retryPostCalls, 0);
    assert.strictEqual(resRetry.body.already_refunded_on_paystack, true);
    assert.strictEqual(resRetry.body.payment.status, 'refunded');

    // Verify final DB states
    const { rows: payRows } = await pool.query('SELECT id, status FROM payments WHERE order_id = $1', [orderId]);
    const byId = Object.fromEntries(payRows.map(r => [r.id, r.status]));
    assert.strictEqual(byId[winPaymentId], 'success');
    assert.strictEqual(byId[dupPaymentId], 'refunded');
    assert.strictEqual(byId[failReconcilePaymentId], 'duplicate');
    assert.strictEqual(byId[retryDupPaymentId], 'refunded');

    const { rows: ordRows } = await pool.query('SELECT payment_status FROM orders WHERE id = $1', [orderId]);
    assert.strictEqual(ordRows[0].payment_status, 'paid');

    const { rows: logRows } = await pool.query('SELECT note FROM order_status_log WHERE order_id = $1', [orderId]);
    assert(logRows.some(r => r.note.includes(dupRef) && r.note.includes('999001') && r.note.includes('150.00')));
    assert(logRows.some(r => r.note.includes(failRecRef) && r.note.includes('999003')));

    console.log('ALL DUPLICATE PAYMENT REFUND & RECONCILIATION TESTS PASSED');
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

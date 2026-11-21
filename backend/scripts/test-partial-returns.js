'use strict';

require('dotenv').config();
const assert = require('assert');
const crypto = require('crypto');
const { randomUUID: uuid } = crypto;

process.env.PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || 'sk_test_partial_returns_only';

const pool = require('../src/config/database');
const paystackAPI = require('../src/config/paystack');
const { calculateReturnRefund } = require('../src/utils/returnMath');
const {
  getOrderReturns,
  createReturnRequest,
  adminCreateReturnRequest,
  cancelReturnRequest,
  approveReturnRequestById,
} = require('../src/controllers/return.controller');
const { refundOrder, requestReturn } = require('../src/controllers/order.controller');
const { handleWebhook } = require('../src/controllers/payment.controller');
const { reconcileReturnRequestRefunds } = require('../src/workers/refund.reconciliation.worker');

const ALLOWED_POST_REFUND_KEYS = new Set([
  'transaction',
  'amount',
  'currency',
  'customer_note',
  'merchant_note',
]);

function assertDocumentedRefundRequestBody(payload) {
  assert(payload && typeof payload === 'object', 'POST /refund body must be a JSON object');
  assert(!('reference' in payload), 'POST /refund body must NOT include undocumented "reference" key');
  for (const key of Object.keys(payload)) {
    assert(
      ALLOWED_POST_REFUND_KEYS.has(key),
      `POST /refund body contains undocumented key "${key}" (allowed: ${[...ALLOWED_POST_REFUND_KEYS].join(', ')})`
    );
  }
  assert(typeof payload.transaction === 'string' && payload.transaction.length > 0, 'POST /refund requires transaction');
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    send(p) { this.body = p; return this; },
  };
}

async function sendSignedWebhook(payloadObj) {
  const rawBody = Buffer.from(JSON.stringify(payloadObj), 'utf8');
  const sig = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest('hex');
  const res = makeRes();
  await handleWebhook({
    headers: { 'x-paystack-signature': sig },
    rawBody,
    body: payloadObj,
  }, res);
  return res;
}

async function run() {
  const originalAdapter = paystackAPI.defaults.adapter;

  // ── 1. Pure proration unit test: last unit absorbs pesewa remainder ─────────
  {
    const items = [{ id: 'item-1', quantity: 3, price_at_purchase: '100.00', subtotal: '300.00' }];
    // Gross 300.00 - 10.00 coupon = 290.00 net (29000 pesewas)
    const r1 = calculateReturnRefund({
      orderItems: items,
      discountAmount: 10,
      alreadyCommittedQtyByItemId: {},
      alreadyCommittedItemRefundPesewas: 0,
      requestedItems: [{ order_item_id: 'item-1', quantity: 1 }],
    });
    assert.strictEqual(r1.totalRefundPesewas, 9666);
    assert.strictEqual(r1.completesAllItems, false);

    const r2 = calculateReturnRefund({
      orderItems: items,
      discountAmount: 10,
      alreadyCommittedQtyByItemId: { 'item-1': 1 },
      alreadyCommittedItemRefundPesewas: 9666,
      requestedItems: [{ order_item_id: 'item-1', quantity: 1 }],
    });
    assert.strictEqual(r2.totalRefundPesewas, 9666);
    assert.strictEqual(r2.completesAllItems, false);

    const r3 = calculateReturnRefund({
      orderItems: items,
      discountAmount: 10,
      alreadyCommittedQtyByItemId: { 'item-1': 2 },
      alreadyCommittedItemRefundPesewas: 9666 + 9666,
      requestedItems: [{ order_item_id: 'item-1', quantity: 1 }],
    });
    assert.strictEqual(r3.completesAllItems, true);
    assert.strictEqual(r3.totalRefundPesewas, 9668, 'Last returned unit must absorb 2-pesewa remainder');
    assert.strictEqual(r1.totalRefundPesewas + r2.totalRefundPesewas + r3.totalRefundPesewas, 29000);
  }

  // Seed isolated users, product, order (5 units @ GHS 50.00 = GHS 250.00, no delivery fee)
  const ownerId = uuid();
  const otherUserId = uuid();
  const adminId = uuid();
  const productId = uuid();
  const orderId = uuid();
  const orderItemId = uuid();
  const winPayId = uuid();
  const winRef = `tx_pr_win_${Date.now()}`;
  const orderNumber = `ORD-PRTEST01`;

  // Second order for 3-tier webhook precedence test
  const precOrderId = uuid();
  const precOrderItemId = uuid();
  const precWinPayId = uuid();
  const precDupPayId = uuid();
  const precReturnId = uuid();
  const precWinRef = `tx_prec_win_${Date.now()}`;
  const precDupRef = `tx_prec_dup_${Date.now()}`;
  const precOrderNum = `ORD-PRPREC01`;

  try {
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_active)
       VALUES ($1, $2, 'h', 'Owner', 'User', 'customer', true),
              ($3, $4, 'h', 'Other', 'User', 'customer', true),
              ($5, $6, 'h', 'Admin', 'User', 'admin', true)`,
      [
        ownerId, `pr-owner-${Date.now()}@example.test`,
        otherUserId, `pr-other-${Date.now()}@example.test`,
        adminId, `pr-admin-${Date.now()}@example.test`,
      ]
    );

    await pool.query(
      `INSERT INTO products (id, name, price, stock_quantity, sku, category, is_active)
       VALUES ($1, 'Test Shea Cream', 50.00, 10, $2, 'Body Cream', true)`,
      [productId, `SKU-PR-${Date.now()}`]
    );

    await pool.query(
      `INSERT INTO orders (id, customer_id, order_number, total_amount, discount_amount, delivery_fee,
                           status, payment_status, payment_reference, fulfillment_method, payment_method, delivered_at)
       VALUES ($1, $2, $3, 250.00, 0.00, 0.00, 'delivered', 'paid', $4, 'delivery', 'paystack', NOW())`,
      [orderId, ownerId, orderNumber, winRef]
    );
    await pool.query(
      `INSERT INTO order_items (id, order_id, product_id, quantity, price_at_purchase, subtotal)
       VALUES ($1, $2, $3, 5, 50.00, 250.00)`,
      [orderItemId, orderId, productId]
    );
    await pool.query(
      `INSERT INTO payments (id, order_id, amount, currency, status, payment_method, paystack_reference)
       VALUES ($1, $2, 250.00, 'GHS', 'success', 'paystack', $3)`,
      [winPayId, orderId, winRef]
    );

    // ── 2. Ownership enforcement (another user gets 403) ──────────────────────
    const rOtherGet = makeRes();
    await getOrderReturns({ params: { orderId }, user: { id: otherUserId, role: 'customer' } }, rOtherGet);
    assert.strictEqual(rOtherGet.statusCode, 403, 'Non-owner GET returns must get 403');

    const rOtherPost = makeRes();
    await createReturnRequest({
      params: { orderId },
      user: { id: otherUserId, role: 'customer' },
      body: { reason: 'Wrong scent', items: [{ order_item_id: orderItemId, quantity: 1 }] },
    }, rOtherPost);
    assert.strictEqual(rOtherPost.statusCode, 403, 'Non-owner POST return must get 403');

    // ── 3. Customer creates return for 1 of 5 items ───────────────────────────
    const rCreate1 = makeRes();
    await createReturnRequest({
      params: { orderId },
      user: { id: ownerId, role: 'customer' },
      body: { reason: 'Damaged lid on 1 jar', items: [{ order_item_id: orderItemId, quantity: 1 }] },
    }, rCreate1);
    assert.strictEqual(rCreate1.statusCode, 201, `Expected 201, got ${rCreate1.statusCode}: ${JSON.stringify(rCreate1.body)}`);
    const returnId1 = rCreate1.body.return_request.id;
    assert.strictEqual(Number(rCreate1.body.return_request.refund_amount), 50);

    // ── 4. Blocking guards while return is pending ────────────────────────────
    const rBlockFull = makeRes();
    await refundOrder({ params: { orderId }, user: { id: adminId, role: 'admin' }, body: { method: 'paystack' } }, rBlockFull);
    assert.strictEqual(rBlockFull.statusCode, 409, 'Full refundOrder must be blocked (409) while return is pending');

    const rBlockLegacy = makeRes();
    await requestReturn({ params: { orderId }, user: { id: ownerId, role: 'customer' }, body: { reason: 'Legacy return' } }, rBlockLegacy);
    assert.strictEqual(rBlockLegacy.statusCode, 409, 'Legacy requestReturn must be blocked (409) while return is pending');

    // Over-return (5 more when only 4 remaining) -> 400
    const rOver = makeRes();
    await createReturnRequest({
      params: { orderId },
      user: { id: ownerId, role: 'customer' },
      body: { reason: 'Try over-returning', items: [{ order_item_id: orderItemId, quantity: 5 }] },
    }, rOver);
    assert.strictEqual(rOver.statusCode, 400, 'Over-returning must be rejected with 400');

    // ── 5. Customer cancels pending return -> frees quantity ──────────────────
    const rOtherCancel = makeRes();
    await cancelReturnRequest({ params: { orderId, returnId: returnId1 }, user: { id: otherUserId, role: 'customer' } }, rOtherCancel);
    assert.strictEqual(rOtherCancel.statusCode, 403, 'Non-owner cancel must get 403');

    const rCancel = makeRes();
    await cancelReturnRequest({ params: { orderId, returnId: returnId1 }, user: { id: ownerId, role: 'customer' } }, rCancel);
    assert.strictEqual(rCancel.statusCode, 200);
    assert.strictEqual(rCancel.body.return_request.status, 'cancelled');

    // Re-create return for 1 of 5 items
    const rCreate2 = makeRes();
    await createReturnRequest({
      params: { orderId },
      user: { id: ownerId, role: 'customer' },
      body: { reason: 'Unopened jar return', items: [{ order_item_id: orderItemId, quantity: 1 }] },
    }, rCreate2);
    assert.strictEqual(rCreate2.statusCode, 201);
    const returnId2 = rCreate2.body.return_request.id;

    // ── 6. Write-before-Paystack + refund_failed -> refund_pending retry ──────
    let dbStatusDuringPaystackCall = null;
    let dbRefDuringPaystackCall = null;
    paystackAPI.defaults.adapter = async (config) => {
      if (config.method === 'post' && config.url === '/refund') {
        assertDocumentedRefundRequestBody(JSON.parse(config.data));
        // Verify row was committed as refund_pending with self-generated reference BEFORE Paystack call
        const { rows } = await pool.query('SELECT status, refund_reference FROM return_requests WHERE id = $1', [returnId2]);
        dbStatusDuringPaystackCall = rows[0]?.status;
        dbRefDuringPaystackCall = rows[0]?.refund_reference;
        const err = new Error('Paystack temporary 500');
        err.status = 500;
        throw err;
      }
      throw new Error(`Unexpected call: ${config.method} ${config.url}`);
    };

    const rFailApprove = makeRes();
    await approveReturnRequestById({
      params: { returnId: returnId2 },
      user: { id: adminId, role: 'admin' },
      body: { method: 'paystack', restock_items: true },
    }, rFailApprove);
    assert.strictEqual(rFailApprove.statusCode, 502);
    assert.strictEqual(dbStatusDuringPaystackCall, 'refund_pending', 'Must persist refund_pending BEFORE calling Paystack');
    assert(dbRefDuringPaystackCall && dbRefDuringPaystackCall.startsWith('RET-'), 'Must persist self-generated RET- reference BEFORE calling Paystack');

    const { rows: [afterFail] } = await pool.query('SELECT status FROM return_requests WHERE id = $1', [returnId2]);
    assert.strictEqual(afterFail.status, 'refund_failed');

    // Retry from refund_failed -> Paystack returns 'pending' -> stays refund_pending
    let retryPayload = null;
    paystackAPI.defaults.adapter = async (config) => {
      if (config.method === 'get' && config.url === '/refund') {
        return { status: 200, statusText: 'OK', headers: {}, config, data: { status: true, data: [] } };
      }
      if (config.method === 'post' && config.url === '/refund') {
        retryPayload = JSON.parse(config.data);
        assertDocumentedRefundRequestBody(retryPayload);
        return {
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
          data: {
            status: true,
            data: {
              id: 600123,
              status: 'pending',
              amount: retryPayload.amount,
              currency: retryPayload.currency || 'GHS',
              merchant_note: retryPayload.merchant_note || '',
              customer_note: retryPayload.customer_note || '',
            },
          },
        };
      }
      throw new Error(`Unexpected call: ${config.method} ${config.url}`);
    };

    const rRetryApprove = makeRes();
    await approveReturnRequestById({
      params: { returnId: returnId2 },
      user: { id: adminId, role: 'admin' },
      body: { method: 'paystack' },
    }, rRetryApprove);
    assert.strictEqual(rRetryApprove.statusCode, 200);
    assert.strictEqual(retryPayload.amount, 5000);
    assert.strictEqual(rRetryApprove.body.return_request.status, 'refund_pending');
    assert.strictEqual(rRetryApprove.body.return_request.refund_provider_id, '600123');

    // Reconcile return_requests -> Paystack reports 'processed' -> refunded + restocked + inventory_history
    paystackAPI.defaults.adapter = async (config) => {
      if (config.method === 'get' && config.url === '/refund/600123') {
        return {
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
          data: {
            status: true,
            data: {
              id: 600123,
              status: 'processed',
              amount: 5000,
              currency: 'GHS',
              merchant_note: retryPayload.merchant_note || '',
              customer_note: '',
              transaction_reference: winRef,
            },
          },
        };
      }
      throw new Error(`Unexpected reconcile call: ${config.method} ${config.url}`);
    };
    const recStats = await reconcileReturnRequestRefunds({ send: async () => {} });
    assert(recStats.refunded >= 1);

    const { rows: [ordAfterPart] } = await pool.query('SELECT status, payment_status, refund_amount FROM orders WHERE id = $1', [orderId]);
    assert.strictEqual(ordAfterPart.status, 'delivered', 'Partial return keeps order status=delivered');
    assert.strictEqual(ordAfterPart.payment_status, 'partially_refunded');
    assert.strictEqual(Number(ordAfterPart.refund_amount), 50);

    const { rows: [prodAfterRestock] } = await pool.query('SELECT stock_quantity FROM products WHERE id = $1', [productId]);
    assert.strictEqual(Number(prodAfterRestock.stock_quantity), 11, 'Restocked 1 unit (10 -> 11)');
    const { rows: invHist } = await pool.query(`SELECT reason, quantity_change FROM inventory_history WHERE product_id = $1 AND reason = 'return_restock'`, [productId]);
    assert(invHist.length >= 1 && Number(invHist[0].quantity_change) === 1, 'Expected inventory_history return_restock log');

    // Remaining full refund via refundOrder must only send total - cumulative refunded = 200.00 (20000 pesewas)
    let remainingFullPayload = null;
    paystackAPI.defaults.adapter = async (config) => {
      if (config.method === 'post' && config.url === '/refund') {
        remainingFullPayload = JSON.parse(config.data);
        assertDocumentedRefundRequestBody(remainingFullPayload);
        return {
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
          data: {
            status: true,
            data: {
              id: 600999,
              status: 'pending',
              amount: remainingFullPayload.amount,
              currency: remainingFullPayload.currency || 'GHS',
              merchant_note: remainingFullPayload.merchant_note || '',
              customer_note: '',
            },
          },
        };
      }
      throw new Error(`Unexpected full refund call: ${config.method} ${config.url}`);
    };
    const rRemFull = makeRes();
    await refundOrder({ params: { orderId }, user: { id: adminId, role: 'admin' }, body: { method: 'paystack', notes: 'Refund rest' } }, rRemFull);
    assert.strictEqual(rRemFull.statusCode, 200, `Expected 200 for remaining full refund, got ${rRemFull.statusCode}: ${JSON.stringify(rRemFull.body)}`);
    assert.strictEqual(remainingFullPayload.amount, 20000, 'Remaining full refund must be 250 - 50 = 200 GHS (20000 pesewas)');

    // ── 7. 3-Tier Webhook Precedence with ALL THREE present on one order ──────
    await pool.query(
      `INSERT INTO orders (id, customer_id, order_number, total_amount, status, payment_status,
                           refund_status, refund_method, refund_provider_id, payment_reference,
                           fulfillment_method, payment_method, delivered_at)
       VALUES ($1, $2, $3, 300.00, 'delivered', 'paid', 'pending', 'paystack', '700303', $4, 'delivery', 'paystack', NOW())`,
      [precOrderId, ownerId, precOrderNum, precWinRef]
    );
    await pool.query(
      `INSERT INTO order_items (id, order_id, product_id, quantity, price_at_purchase, subtotal)
       VALUES ($1, $2, $3, 3, 100.00, 300.00)`,
      [precOrderItemId, precOrderId, productId]
    );
    await pool.query(
      `INSERT INTO payments (id, order_id, amount, currency, status, payment_method, paystack_reference)
       VALUES ($1, $2, 300.00, 'GHS', 'success', 'paystack', $3),
              ($4, $2, 300.00, 'GHS', 'refund_pending', 'paystack', $5)`,
      [precWinPayId, precOrderId, precWinRef, precDupPayId, precDupRef]
    );
    await pool.query(
      `INSERT INTO return_requests (id, order_id, customer_id, status, reason, refund_amount, refund_method, refund_provider_id, refund_reference)
       VALUES ($1, $2, $3, 'refund_pending', 'Return 1 of 3', 100.00, 'paystack', '700101', 'RET-PRECEDENCE01-1')`,
      [precReturnId, precOrderId, ownerId]
    );
    await pool.query(
      `INSERT INTO return_request_items (id, return_request_id, order_item_id, quantity, unit_refund_amount, line_refund_amount)
       VALUES ($1, $2, $3, 1, 100.00, 100.00)`,
      [uuid(), precReturnId, precOrderItemId]
    );

    // Tier 1 webhook (return_requests via provider_id 700101)
    const w1 = await sendSignedWebhook({
      event: 'refund.processed',
      data: { id: 700101, transaction_reference: precWinRef, merchant_note: 'Return RET-PRECEDENCE01-1', status: 'processed', amount: 10000, currency: 'GHS' },
    });
    assert.strictEqual(w1.statusCode, 200);
    const { rows: [t1Ret] } = await pool.query('SELECT status FROM return_requests WHERE id = $1', [precReturnId]);
    const { rows: [t1Dup] } = await pool.query('SELECT status FROM payments WHERE id = $1', [precDupPayId]);
    const { rows: [t1Ord] } = await pool.query('SELECT refund_status, payment_status FROM orders WHERE id = $1', [precOrderId]);
    assert.strictEqual(t1Ret.status, 'refunded', 'Tier 1 must mark return_request refunded');
    assert.strictEqual(t1Dup.status, 'refund_pending', 'Tier 1 must NOT touch duplicate payment row');
    assert.strictEqual(t1Ord.refund_status, 'pending', 'Tier 1 must NOT touch full-order refund_status');

    // Tier 2 webhook (duplicate payment via transaction_reference precDupRef)
    const w2 = await sendSignedWebhook({
      event: 'refund.processed',
      data: { id: 700202, transaction_reference: precDupRef, status: 'processed', amount: 30000 },
    });
    assert.strictEqual(w2.statusCode, 200);
    const { rows: [t2Dup] } = await pool.query('SELECT status FROM payments WHERE id = $1', [precDupPayId]);
    const { rows: [t2Ord] } = await pool.query('SELECT refund_status FROM orders WHERE id = $1', [precOrderId]);
    assert.strictEqual(t2Dup.status, 'refunded', 'Tier 2 must mark duplicate payment refunded');
    assert.strictEqual(t2Ord.refund_status, 'pending', 'Tier 2 must NOT touch full-order refund_status');

    // Tier 3 webhook (full order refund via provider_id 700303)
    const w3 = await sendSignedWebhook({
      event: 'refund.processed',
      data: { id: 700303, transaction_reference: precWinRef, status: 'processed', amount: 20000 },
    });
    assert.strictEqual(w3.statusCode, 200);
    const { rows: [t3Ord] } = await pool.query('SELECT refund_status, status, payment_status FROM orders WHERE id = $1', [precOrderId]);
    assert.strictEqual(t3Ord.refund_status, 'success', 'Tier 3 must mark full order refund_status=success');
    assert.strictEqual(t3Ord.status, 'refunded');

    // ── 8. Two equal-amount partial returns + webhook BEFORE refund_provider_id stored ──
    const eqOrderId = uuid();
    const eqItemId = uuid();
    const eqPayId = uuid();
    const eqRetA = uuid();
    const eqRetB = uuid();
    const eqTxRef = `tx_eq_${Date.now()}`;
    const eqRefA = 'RET-AAAAAAAAAAAA-1';
    const eqRefB = 'RET-BBBBBBBBBBBB-1';
    try {
      await pool.query(
        `INSERT INTO orders (id, customer_id, order_number, total_amount, status, payment_status,
                             payment_reference, fulfillment_method, payment_method, delivered_at)
         VALUES ($1, $2, 'ORD-PREQUAL1', 200.00, 'delivered', 'paid', $3, 'delivery', 'paystack', NOW())`,
        [eqOrderId, ownerId, eqTxRef]
      );
      await pool.query(
        `INSERT INTO order_items (id, order_id, product_id, quantity, price_at_purchase, subtotal)
         VALUES ($1, $2, $3, 4, 50.00, 200.00)`,
        [eqItemId, eqOrderId, productId]
      );
      await pool.query(
        `INSERT INTO payments (id, order_id, amount, currency, status, payment_method, paystack_reference)
         VALUES ($1, $2, 200.00, 'GHS', 'success', 'paystack', $3)`,
        [eqPayId, eqOrderId, eqTxRef]
      );
      // Both returns have IDENTICAL amount (50.00) and NULL refund_provider_id (webhook arrives first!)
      await pool.query(
        `INSERT INTO return_requests (id, order_id, customer_id, status, reason, refund_amount, refund_method, refund_provider_id, refund_reference, updated_at)
         VALUES ($1, $3, $4, 'refund_pending', 'Equal A', 50.00, 'paystack', NULL, $5, NOW()),
                ($2, $3, $4, 'refund_pending', 'Equal B', 50.00, 'paystack', NULL, $6, NOW() - INTERVAL '45 minutes')`,
        [eqRetA, eqRetB, eqOrderId, ownerId, eqRefA, eqRefB]
      );
      await pool.query(
        `INSERT INTO return_request_items (id, return_request_id, order_item_id, quantity, unit_refund_amount, line_refund_amount)
         VALUES ($1, $3, $5, 1, 50.00, 50.00), ($2, $4, $5, 1, 50.00, 50.00)`,
        [uuid(), uuid(), eqRetA, eqRetB, eqItemId]
      );

      // ── 8a. Ambiguous webhook (2 equal-amount refund_pending rows, NO merchant_note / NO ref) ──
      // Neither return may be auto-resolved; both must remain refund_pending.
      const wAmb = await sendSignedWebhook({
        event: 'refund.processed',
        data: { id: 800888, transaction_reference: eqTxRef, status: 'processed', amount: 5000 },
      });
      assert.strictEqual(wAmb.statusCode, 200);
      const { rows: [ambA] } = await pool.query('SELECT status FROM return_requests WHERE id = $1', [eqRetA]);
      const { rows: [ambB] } = await pool.query('SELECT status FROM return_requests WHERE id = $1', [eqRetB]);
      assert.strictEqual(ambA.status, 'refund_pending', 'Ambiguous webhook must NOT auto-resolve Return A');
      assert.strictEqual(ambB.status, 'refund_pending', 'Ambiguous webhook must NOT auto-resolve Return B');

      // ── 8b. Webhook arrives BEFORE refund_provider_id is stored, carrying our RET- ref in merchant_note ──
      const wEq = await sendSignedWebhook({
        event: 'refund.processed',
        data: { id: 800111, transaction_reference: eqTxRef, merchant_note: `Return ${eqRefA} — ok`, status: 'processed', amount: 5000 },
      });
      assert.strictEqual(wEq.statusCode, 200);
      const { rows: [afterEqA] } = await pool.query('SELECT status, refund_provider_id FROM return_requests WHERE id = $1', [eqRetA]);
      const { rows: [afterEqB] } = await pool.query('SELECT status, refund_provider_id FROM return_requests WHERE id = $1', [eqRetB]);
      assert.strictEqual(afterEqA.status, 'refunded', 'Return A must be matched via merchant_note before refund_provider_id is stored');
      assert.strictEqual(afterEqA.refund_provider_id, '800111');
      assert.strictEqual(afterEqB.status, 'refund_pending', 'Equal-amount Return B must NOT be affected by Return A webhook');

      // ── 9. Unmatched refund_pending > 30 min triggers reconciler admin alert ──
      const unmatchedAlerts = [];
      paystackAPI.defaults.adapter = async (config) => {
        if (config.method === 'get' && config.url === '/refund') {
          return { status: 200, statusText: 'OK', headers: {}, config, data: { status: true, data: [] } };
        }
        throw new Error(`Unexpected call: ${config.method} ${config.url}`);
      };
      const recUnmatched = await reconcileReturnRequestRefunds({
        send: async (q, d, o) => unmatchedAlerts.push({ q, d, o }),
      });
      assert(recUnmatched.unmatchedAlerted >= 1, 'Expected unmatched refund_pending alert after 30 min');
      assert(
        unmatchedAlerts.some(a => a.d.alertKey.startsWith(`ret_refund_unmatched_${eqRetB}`) && a.o?.singletonKey === a.d.alertKey),
        'Expected ret_refund_unmatched alert with singletonKey for eqRetB'
      );

      // ── 10. Return window enforcement: NULL delivered_at (blocked), expired (20d), in-window (5d) ──
      await pool.query(`UPDATE orders SET delivered_at = NULL WHERE id = $1`, [eqOrderId]);
      const rNullDelivered = makeRes();
      await createReturnRequest({
        params: { orderId: eqOrderId },
        user: { id: ownerId, role: 'customer' },
        body: { reason: 'Missing delivered_at', items: [{ order_item_id: eqItemId, quantity: 1 }] },
      }, rNullDelivered);
      assert.strictEqual(rNullDelivered.statusCode, 400, 'Return with NULL delivered_at must be explicitly blocked (400)');
      assert(String(rNullDelivered.body?.error || '').includes('Delivery date could not be verified'));

      // Admin override: admin can still create a return on behalf of customer when delivered_at is NULL
      const rAdminOverride = makeRes();
      await adminCreateReturnRequest({
        params: { orderId: eqOrderId },
        user: { id: adminId, role: 'admin' },
        body: { reason: 'Admin manual override for legacy delivered order', items: [{ order_item_id: eqItemId, quantity: 1 }] },
      }, rAdminOverride);
      assert.strictEqual(rAdminOverride.statusCode, 201, `Admin override return must succeed (201), got ${rAdminOverride.statusCode}`);
      // Cancel it via DB so remaining qty is clean for the subsequent window tests
      await pool.query(`UPDATE return_requests SET status = 'cancelled' WHERE id = $1`, [rAdminOverride.body.return_request.id]);

      await pool.query(`UPDATE orders SET delivered_at = NOW() - INTERVAL '20 days' WHERE id = $1`, [eqOrderId]);
      const rExpired = makeRes();
      await createReturnRequest({
        params: { orderId: eqOrderId },
        user: { id: ownerId, role: 'customer' },
        body: { reason: 'Late return', items: [{ order_item_id: eqItemId, quantity: 1 }] },
      }, rExpired);
      assert.strictEqual(rExpired.statusCode, 400, 'Return after return_window_days must be rejected with 400');

      await pool.query(`UPDATE orders SET delivered_at = NOW() - INTERVAL '5 days' WHERE id = $1`, [eqOrderId]);
      const rInWindow = makeRes();
      await createReturnRequest({
        params: { orderId: eqOrderId },
        user: { id: ownerId, role: 'customer' },
        body: { reason: 'Within window', items: [{ order_item_id: eqItemId, quantity: 1 }] },
      }, rInWindow);
      assert.strictEqual(rInWindow.statusCode, 201, 'Return within return_window_days must succeed (201)');
      const concRetId1 = rInWindow.body.return_request.id;

      // ── 11. Concurrency: approve/approve & cancel/approve (also tests merchant_note stripped warning) ──
      let concPostCount = 0;
      paystackAPI.defaults.adapter = async (config) => {
        if (config.method === 'post' && config.url === '/refund') {
          concPostCount++;
          const body = JSON.parse(config.data);
          assertDocumentedRefundRequestBody(body);
          await new Promise(r => setTimeout(r, 40));
          // Intentionally omit RET- tag from echoed merchant_note to verify warning path + provider id reliance
          return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config,
            data: { status: true, data: { id: 800222, status: 'pending', amount: body.amount, currency: 'GHS', merchant_note: '', customer_note: '' } },
          };
        }
        throw new Error(`Unexpected call: ${config.method} ${config.url}`);
      };
      const [ra1, ra2] = [makeRes(), makeRes()];
      await Promise.all([
        approveReturnRequestById({ params: { returnId: concRetId1 }, user: { id: adminId, role: 'admin' }, body: { method: 'paystack' } }, ra1),
        approveReturnRequestById({ params: { returnId: concRetId1 }, user: { id: adminId, role: 'admin' }, body: { method: 'paystack' } }, ra2),
      ]);
      const approveStatuses = [ra1.statusCode, ra2.statusCode].sort();
      assert.strictEqual(approveStatuses[0], 200, `Expected one 200 in concurrent approve/approve, got ${approveStatuses}`);
      assert([400, 409].includes(approveStatuses[1]), `Expected one 400/409 in concurrent approve/approve, got ${approveStatuses}`);
      assert.strictEqual(concPostCount, 1, 'Concurrent approve/approve must call POST /refund at most ONCE');
      const { rows: [concAfter] } = await pool.query('SELECT refund_provider_id FROM return_requests WHERE id = $1', [concRetId1]);
      assert.strictEqual(concAfter.refund_provider_id, '800222', 'Must store refund_provider_id even when merchant_note is not echoed');

      // Concurrent cancel/approve on a fresh pending return
      const rFresh = makeRes();
      await createReturnRequest({
        params: { orderId: eqOrderId },
        user: { id: ownerId, role: 'customer' },
        body: { reason: 'Race cancel vs approve', items: [{ order_item_id: eqItemId, quantity: 1 }] },
      }, rFresh);
      assert.strictEqual(rFresh.statusCode, 201);
      const concRetId2 = rFresh.body.return_request.id;

      let racePostCount = 0;
      paystackAPI.defaults.adapter = async (config) => {
        if (config.method === 'post' && config.url === '/refund') {
          racePostCount++;
          const body = JSON.parse(config.data);
          assertDocumentedRefundRequestBody(body);
          return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config,
            data: { status: true, data: { id: 800333, status: 'pending', amount: body.amount, currency: 'GHS', merchant_note: body.merchant_note || '', customer_note: '' } },
          };
        }
        throw new Error(`Unexpected call: ${config.method} ${config.url}`);
      };
      const [rc, ra] = [makeRes(), makeRes()];
      await Promise.all([
        cancelReturnRequest({ params: { orderId: eqOrderId, returnId: concRetId2 }, user: { id: ownerId, role: 'customer' } }, rc),
        approveReturnRequestById({ params: { returnId: concRetId2 }, user: { id: adminId, role: 'admin' }, body: { method: 'paystack' } }, ra),
      ]);
      const raceStatuses = [rc.statusCode, ra.statusCode].sort();
      assert.strictEqual(raceStatuses[0], 200, `Expected exactly one winner in cancel/approve race, got ${raceStatuses}`);
      assert([400, 409].includes(raceStatuses[1]), `Expected loser to get 400/409 in cancel/approve race, got ${raceStatuses}`);
      if (rc.statusCode === 200) {
        assert.strictEqual(racePostCount, 0, 'If cancel won, POST /refund must NOT be called');
      } else {
        assert.strictEqual(racePostCount, 1, 'If approve won, POST /refund must be called once');
      }
    } finally {
      await pool.query('DELETE FROM return_requests WHERE order_id = $1', [eqOrderId]).catch(() => {});
      await pool.query('DELETE FROM order_status_log WHERE order_id = $1', [eqOrderId]).catch(() => {});
      await pool.query('DELETE FROM payments WHERE order_id = $1', [eqOrderId]).catch(() => {});
      await pool.query('DELETE FROM order_items WHERE order_id = $1', [eqOrderId]).catch(() => {});
      await pool.query('DELETE FROM orders WHERE id = $1', [eqOrderId]).catch(() => {});
      await pool.query("DELETE FROM processed_events WHERE event_id LIKE 'paystack_refund.processed_800%'").catch(() => {});
    }

    console.log('ALL PARTIAL RETURNS, PRORATION, RETRY, WINDOW, CONCURRENCY & 3-TIER PRECEDENCE TESTS PASSED');
  } finally {
    paystackAPI.defaults.adapter = originalAdapter;
    for (const oid of [orderId, precOrderId]) {
      await pool.query('DELETE FROM return_requests WHERE order_id = $1', [oid]).catch(() => {});
      await pool.query('DELETE FROM order_status_log WHERE order_id = $1', [oid]).catch(() => {});
      await pool.query('DELETE FROM payments WHERE order_id = $1', [oid]).catch(() => {});
      await pool.query('DELETE FROM order_items WHERE order_id = $1', [oid]).catch(() => {});
      await pool.query('DELETE FROM orders WHERE id = $1', [oid]).catch(() => {});
    }
    await pool.query("DELETE FROM processed_events WHERE event_id LIKE 'paystack_refund.processed_700%'").catch(() => {});
    await pool.query('DELETE FROM inventory_history WHERE product_id = $1', [productId]).catch(() => {});
    await pool.query('DELETE FROM products WHERE id = $1', [productId]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id IN ($1, $2, $3)', [ownerId, otherUserId, adminId]).catch(() => {});
    await pool.end();
  }
}

run().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});

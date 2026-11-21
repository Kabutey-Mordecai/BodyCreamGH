'use strict';

require('dotenv').config();
const assert = require('assert');
const { randomUUID: uuid } = require('crypto');
const pool = require('../src/config/database');
const { getDashboard, getFinancials } = require('../src/controllers/admin.controller');

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
  };
}

async function callDashboard() {
  const res = makeRes();
  await getDashboard({}, res);
  assert.strictEqual(res.statusCode, 200);
  return res.body;
}

async function callFinancials() {
  const res = makeRes();
  await getFinancials({ query: { days: '30' } }, res);
  assert.strictEqual(res.statusCode, 200);
  return res.body;
}

async function run() {
  const idUnrefunded = uuid();
  const idPartial = uuid();
  const idFull = uuid();

  try {
    const dashBefore = await callDashboard();
    const finBefore = await callFinancials();

    // Seed:
    // 1. Unrefunded paid order: GHS 200.00
    // 2. Partially refunded order: GHS 150.00 total, GHS 50.00 refunded (net GHS 100.00)
    // 3. Fully refunded order: GHS 100.00 total, GHS 100.00 refunded (net GHS 0.00)
    await pool.query(
      `INSERT INTO orders (id, order_number, total_amount, refund_amount, status, payment_status, refund_status, fulfillment_method, payment_method)
       VALUES ($1, 'ORD-REVTEST1', 200.00, 0.00,   'delivered', 'paid',               'not_requested', 'delivery', 'paystack'),
              ($2, 'ORD-REVTEST2', 150.00, 50.00,  'delivered', 'partially_refunded', 'not_requested', 'delivery', 'paystack'),
              ($3, 'ORD-REVTEST3', 100.00, 100.00, 'refunded',  'refunded',           'success',       'delivery', 'paystack')`,
      [idUnrefunded, idPartial, idFull]
    );

    const dashAfter = await callDashboard();
    const finAfter = await callFinancials();

    const deltaTotalRev = Math.round((dashAfter.totalRevenue - dashBefore.totalRevenue) * 100) / 100;
    const deltaTodayRev = Math.round((dashAfter.todayRevenue - dashBefore.todayRevenue) * 100) / 100;
    const deltaPaidOrders = dashAfter.paidOrders - dashBefore.paidOrders;

    assert.strictEqual(deltaTotalRev, 300, `Expected dashboard totalRevenue delta = 300.00 (200 + 100), got ${deltaTotalRev}`);
    assert.strictEqual(deltaTodayRev, 300, `Expected dashboard todayRevenue delta = 300.00, got ${deltaTodayRev}`);
    assert.strictEqual(deltaPaidOrders, 2, `Expected dashboard paidOrders delta = 2, got ${deltaPaidOrders}`);

    const deltaGross = Math.round((finAfter.gross_revenue - finBefore.gross_revenue) * 100) / 100;
    const deltaRefunded = Math.round((finAfter.total_refunded - finBefore.total_refunded) * 100) / 100;
    const deltaNet = Math.round((finAfter.net_revenue - finBefore.net_revenue) * 100) / 100;

    assert.strictEqual(deltaGross, 450, `Expected financials gross_revenue delta = 450.00, got ${deltaGross}`);
    assert.strictEqual(deltaRefunded, 150, `Expected financials total_refunded delta = 150.00 (50 + 100), got ${deltaRefunded}`);
    assert.strictEqual(deltaNet, 300, `Expected financials net_revenue delta = 300.00, got ${deltaNet}`);

    console.log('ALL REVENUE & REPORTING TESTS PASSED (dashboard net +300, financials gross +450 / refunded +150 / net +300)');
  } finally {
    await pool.query('DELETE FROM orders WHERE id IN ($1, $2, $3)', [idUnrefunded, idPartial, idFull]).catch(() => {});
    await pool.end();
  }
}

run().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});

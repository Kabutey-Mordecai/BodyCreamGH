'use strict';

require('dotenv').config();
const assert = require('assert');
const { randomUUID: uuid } = require('crypto');

// Guard: must run against TEST_DATABASE_URL
const testUrl = (process.env.TEST_DATABASE_URL || '').trim();
if (!testUrl) {
  console.error('[FATAL] TEST_DATABASE_URL must be set');
  process.exit(1);
}
process.env.DATABASE_URL = testUrl;

const pool = require('../src/config/database');
const { expireUnpaidOrders } = require('../src/workers/order.expiry.worker');
const { processPaymentSuccess } = require('../src/workers/payment.worker');

async function main() {
  const prodId = uuid();
  const varProdId = uuid();
  const optTypeId = uuid();
  const optValId = uuid();
  const variantId = uuid();
  const couponCode = `EXP${Date.now().toString().slice(-6)}`;
  const couponId = uuid();

  const expiredOrderId = uuid();
  const youngOrderId = uuid();
  const paidRowOrderId = uuid();
  const verifyPaidOrderId = uuid();
  const verifyFailOrderId = uuid();
  const lateReviveOrderId = uuid();
  const lateOosOrderId = uuid();

  const sentAlerts = [];
  const mockBoss = {
    send: async (queue, data) => {
      sentAlerts.push({ queue, data });
    },
  };

  try {
    // Seed products & variant
    await pool.query(
      `INSERT INTO products (id, name, price, stock_quantity, is_active)
       VALUES ($1, 'Expiry Test Cream', 100.00, 10, TRUE),
              ($2, 'Expiry Variant Cream', 80.00, 0, TRUE)`,
      [prodId, varProdId]
    );
    await pool.query(
      `INSERT INTO product_option_types (id, product_id, name, position) VALUES ($1, $2, 'Size', 0)`,
      [optTypeId, varProdId]
    );
    await pool.query(
      `INSERT INTO product_option_values (id, option_type_id, product_id, value, position) VALUES ($1, $2, $3, 'Large', 0)`,
      [optValId, optTypeId, varProdId]
    );
    await pool.query(
      `INSERT INTO product_variants (id, product_id, sku, price, stock_quantity, is_active)
       VALUES ($1, $2, $3, 120.00, 5, TRUE)`,
      [variantId, varProdId, `SKU-${Date.now()}`]
    );
    await pool.query(
      `INSERT INTO product_variant_option_values (variant_id, option_value_id) VALUES ($1, $2)`,
      [variantId, optValId]
    );

    // Seed coupon with uses_count = 3
    await pool.query(
      `INSERT INTO coupons (id, code, type, value, uses_count, active)
       VALUES ($1, $2, 'fixed', 10.00, 3, TRUE)`,
      [couponId, couponCode]
    );

    // 1. Expired unpaid order (45 min old) with both product + variant + coupon
    await pool.query(
      `INSERT INTO orders (id, order_number, total_amount, status, payment_status, payment_method, coupon_code, created_at)
       VALUES ($1, $2, 220.00, 'pending', 'unpaid', 'paystack', $3, NOW() - INTERVAL '45 minutes')`,
      [expiredOrderId, `EXP-1-${Date.now()}`, couponCode]
    );
    await pool.query(
      `INSERT INTO order_items (id, order_id, product_id, quantity, price_at_purchase, subtotal)
       VALUES ($1, $2, $3, 2, 100.00, 200.00), ($4, $2, $5, 1, 120.00, 120.00)`,
      [uuid(), expiredOrderId, prodId, uuid(), varProdId]
    );
    await pool.query(
      `UPDATE order_items SET variant_id = $1 WHERE order_id = $2 AND product_id = $3`,
      [variantId, expiredOrderId, varProdId]
    );

    // 2. Young unpaid order (10 min old) -> must be skipped
    await pool.query(
      `INSERT INTO orders (id, order_number, total_amount, status, payment_status, payment_method, created_at)
       VALUES ($1, $2, 100.00, 'pending', 'unpaid', 'paystack', NOW() - INTERVAL '10 minutes')`,
      [youngOrderId, `EXP-2-${Date.now()}`]
    );

    // 3. Stale order that has an active 'success' payments row -> must be skipped
    await pool.query(
      `INSERT INTO orders (id, order_number, total_amount, status, payment_status, payment_method, created_at)
       VALUES ($1, $2, 100.00, 'pending', 'unpaid', 'paystack', NOW() - INTERVAL '45 minutes')`,
      [paidRowOrderId, `EXP-3-${Date.now()}`]
    );
    await pool.query(
      `INSERT INTO payments (id, order_id, amount, status, paystack_reference)
       VALUES ($1, $2, 100.00, 'success', $3)`,
      [uuid(), paidRowOrderId, `ref_paid_${Date.now()}`]
    );

    // 4. Stale order where Paystack verify says 'success' -> must be marked paid, NOT cancelled
    const verifyPaidRef = `ref_vpaid_${Date.now()}`;
    await pool.query(
      `INSERT INTO orders (id, order_number, total_amount, status, payment_status, payment_method, payment_reference, created_at)
       VALUES ($1, $2, 100.00, 'pending', 'unpaid', 'paystack', $3, NOW() - INTERVAL '45 minutes')`,
      [verifyPaidOrderId, `EXP-4-${Date.now()}`, verifyPaidRef]
    );
    await pool.query(
      `INSERT INTO payments (id, order_id, amount, status, paystack_reference)
       VALUES ($1, $2, 100.00, 'pending', $3)`,
      [uuid(), verifyPaidOrderId, verifyPaidRef]
    );

    // 5. Stale order where Paystack verify times out/errors -> must be skipped
    const verifyFailRef = `ref_vfail_${Date.now()}`;
    await pool.query(
      `INSERT INTO orders (id, order_number, total_amount, status, payment_status, payment_method, payment_reference, created_at)
       VALUES ($1, $2, 100.00, 'pending', 'unpaid', 'paystack', $3, NOW() - INTERVAL '45 minutes')`,
      [verifyFailOrderId, `EXP-5-${Date.now()}`, verifyFailRef]
    );
    await pool.query(
      `INSERT INTO payments (id, order_id, amount, status, paystack_reference)
       VALUES ($1, $2, 100.00, 'pending', $3)`,
      [uuid(), verifyFailOrderId, verifyFailRef]
    );

    const mockPaystack = {
      get: async (url) => {
        if (url.includes(verifyPaidRef)) {
          return { data: { data: { status: 'success', amount: 10000, currency: 'GHS' } } };
        }
        if (url.includes(verifyFailRef)) {
          throw new Error('Simulated Paystack timeout');
        }
        return { data: { data: { status: 'abandoned', amount: 10000, currency: 'GHS' } } };
      },
    };

    // Run expiry pass #1
    const res1 = await expireUnpaidOrders({ ttlMinutes: 30, paystackClient: mockPaystack, boss: mockBoss });
    assert.strictEqual(res1.expiredCount, 1, 'Only the 1 truly expired unpaid order should be cancelled');
    assert.strictEqual(res1.paidRecoveredCount, 1, 'Paystack-verified paid order should be recovered');
    assert.strictEqual(res1.skippedVerifyErrorCount, 1, 'Verify-timeout order should be skipped');

    // Assert stock restored (+2 on product: 10->12, +1 on variant: 5->6)
    const pAfter1 = await pool.query(`SELECT stock_quantity FROM products WHERE id = $1`, [prodId]);
    assert.strictEqual(pAfter1.rows[0].stock_quantity, 12, 'Product stock should be restored from 10 to 12');

    const vAfter1 = await pool.query(`SELECT stock_quantity FROM product_variants WHERE id = $1`, [variantId]);
    assert.strictEqual(vAfter1.rows[0].stock_quantity, 6, 'Variant stock should be restored from 5 to 6');

    const cAfter1 = await pool.query(`SELECT uses_count FROM coupons WHERE id = $1`, [couponId]);
    assert.strictEqual(cAfter1.rows[0].uses_count, 2, 'Coupon uses_count should be decremented from 3 to 2');

    // Assert status log inserted
    const logRes = await pool.query(
      `SELECT from_status, to_status FROM order_status_log WHERE order_id = $1`,
      [expiredOrderId]
    );
    assert.strictEqual(logRes.rows.length, 1);
    assert.strictEqual(logRes.rows[0].to_status, 'cancelled');

    // Assert young order, paid-row order, and verify-fail order stayed pending
    for (const id of [youngOrderId, paidRowOrderId, verifyFailOrderId]) {
      const r = await pool.query(`SELECT status FROM orders WHERE id = $1`, [id]);
      assert.strictEqual(r.rows[0].status, 'pending', `Order ${id} must remain pending`);
    }

    // Assert verify-paid order was marked confirmed + paid
    const vpRes = await pool.query(`SELECT status, payment_status FROM orders WHERE id = $1`, [verifyPaidOrderId]);
    assert.strictEqual(vpRes.rows[0].status, 'confirmed');
    assert.strictEqual(vpRes.rows[0].payment_status, 'paid');

    // Run expiry pass #2 (idempotency check — stock/coupon must NOT change again)
    const res2 = await expireUnpaidOrders({ ttlMinutes: 30, paystackClient: mockPaystack, boss: mockBoss });
    assert.strictEqual(res2.expiredCount, 0);
    const pAfter2 = await pool.query(`SELECT stock_quantity FROM products WHERE id = $1`, [prodId]);
    assert.strictEqual(pAfter2.rows[0].stock_quantity, 12, 'Second run must not double-restore stock');
    const cAfter2 = await pool.query(`SELECT uses_count FROM coupons WHERE id = $1`, [couponId]);
    assert.strictEqual(cAfter2.rows[0].uses_count, 2, 'Second run must not double-decrement coupon');

    // 6a. Late charge.success webhook on auto-expired order WITH stock -> should REVIVE
    const lateReviveRef = `ref_revive_${Date.now()}`;
    await pool.query(
      `INSERT INTO orders (id, order_number, total_amount, status, payment_status, payment_method, stock_restored, cancellation_reason, created_at)
       VALUES ($1, $2, 100.00, 'cancelled', 'unpaid', 'paystack', TRUE, 'Unpaid Paystack checkout expired after 30 minutes', NOW() - INTERVAL '60 minutes')`,
      [lateReviveOrderId, `EXP-6-${Date.now()}`]
    );
    await pool.query(
      `INSERT INTO order_items (id, order_id, product_id, quantity, price_at_purchase, subtotal)
       VALUES ($1, $2, $3, 2, 100.00, 200.00)`,
      [uuid(), lateReviveOrderId, prodId]
    );
    await pool.query(
      `INSERT INTO payments (id, order_id, amount, status, paystack_reference)
       VALUES ($1, $2, 100.00, 'pending', $3)`,
      [uuid(), lateReviveOrderId, lateReviveRef]
    );

    await processPaymentSuccess({
      data: { reference: lateReviveRef, orderId: lateReviveOrderId, amountPesewas: 10000, currency: 'GHS' },
    }, mockBoss);

    const revivedRow = await pool.query(`SELECT status, payment_status, stock_restored FROM orders WHERE id = $1`, [lateReviveOrderId]);
    assert.strictEqual(revivedRow.rows[0].status, 'confirmed', 'Late charge.success with stock must revive order to confirmed');
    assert.strictEqual(revivedRow.rows[0].payment_status, 'paid');
    assert.strictEqual(revivedRow.rows[0].stock_restored, false);
    const pAfterRevive = await pool.query(`SELECT stock_quantity FROM products WHERE id = $1`, [prodId]);
    assert.strictEqual(pAfterRevive.rows[0].stock_quantity, 10, 'Reviving order must re-deduct 2 units (12->10)');

    // 6b. Late charge.success webhook on auto-expired order WITHOUT enough stock -> flag payment_review + alert admin
    const lateOosRef = `ref_oos_${Date.now()}`;
    await pool.query(
      `INSERT INTO orders (id, order_number, total_amount, status, payment_status, payment_method, stock_restored, cancellation_reason, created_at)
       VALUES ($1, $2, 100.00, 'cancelled', 'unpaid', 'paystack', TRUE, 'Unpaid Paystack checkout expired after 30 minutes', NOW() - INTERVAL '60 minutes')`,
      [lateOosOrderId, `EXP-7-${Date.now()}`]
    );
    await pool.query(
      `INSERT INTO order_items (id, order_id, product_id, quantity, price_at_purchase, subtotal)
       VALUES ($1, $2, $3, 99, 100.00, 9900.00)`,
      [uuid(), lateOosOrderId, prodId]
    );
    await pool.query(
      `INSERT INTO payments (id, order_id, amount, status, paystack_reference)
       VALUES ($1, $2, 100.00, 'pending', $3)`,
      [uuid(), lateOosOrderId, lateOosRef]
    );

    await processPaymentSuccess({
      data: { reference: lateOosRef, orderId: lateOosOrderId, amountPesewas: 10000, currency: 'GHS' },
    }, mockBoss);

    const oosRow = await pool.query(`SELECT status, payment_status FROM orders WHERE id = $1`, [lateOosOrderId]);
    assert.strictEqual(oosRow.rows[0].status, 'cancelled', 'Out-of-stock late payment must stay cancelled');
    assert.strictEqual(oosRow.rows[0].payment_status, 'payment_review', 'Out-of-stock late payment must flag payment_review');
    assert.ok(sentAlerts.some(a => a.queue === 'notification/admin-payment-alert' && a.data.orderId === lateOosOrderId));

    console.log('ALL ORDER EXPIRY & LATE WEBHOOK TESTS PASSED (8/8)');
  } finally {
    // Cleanup seeded rows
    await pool.query(`DELETE FROM order_status_log WHERE order_id = ANY($1::uuid[])`, [[expiredOrderId, verifyPaidOrderId, lateReviveOrderId, lateOosOrderId]]).catch(() => {});
    await pool.query(`DELETE FROM payments WHERE order_id = ANY($1::uuid[])`, [[paidRowOrderId, verifyPaidOrderId, verifyFailOrderId, lateReviveOrderId, lateOosOrderId]]).catch(() => {});
    await pool.query(`DELETE FROM order_items WHERE order_id = ANY($1::uuid[])`, [[expiredOrderId, lateReviveOrderId, lateOosOrderId]]).catch(() => {});
    await pool.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [[expiredOrderId, youngOrderId, paidRowOrderId, verifyPaidOrderId, verifyFailOrderId, lateReviveOrderId, lateOosOrderId]]).catch(() => {});
    await pool.query(`DELETE FROM coupons WHERE id = $1`, [couponId]).catch(() => {});
    await pool.query(`DELETE FROM inventory_logs WHERE product_id = ANY($1::uuid[])`, [[prodId, varProdId]]).catch(() => {});
    await pool.query(`DELETE FROM products WHERE id = ANY($1::uuid[])`, [[prodId, varProdId]]).catch(() => {});
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

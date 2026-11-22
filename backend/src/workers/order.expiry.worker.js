'use strict';

const pool = require('../config/database');
const paystackAPI = require('../config/paystack');
const InventoryModel = require('../models/inventory.model');
const VariantModel = require('../models/variant.model');
const { processPaymentSuccess } = require('./payment.worker');
const { logStatusChange } = require('../utils/audit');
const logger = require('../utils/logger');

const DEFAULT_TTL_MINUTES = parseInt(process.env.UNPAID_ORDER_TTL_MINUTES, 10) || 30;
const BATCH_LIMIT = 50;

/**
 * Cancel stale pending+unpaid Paystack orders older than ttlMinutes and
 * atomically restore product/variant stock and coupon usage.
 *
 * Before cancelling, verifies any Paystack reference on the order:
 *  - If Paystack reports 'success', marks the order paid via processPaymentSuccess.
 *  - If verification fails or times out, skips the order this run (never cancels on uncertainty).
 */
async function expireUnpaidOrders({
  ttlMinutes = DEFAULT_TTL_MINUTES,
  paystackClient = paystackAPI,
  boss = null,
} = {}) {
  const safeTtl = Math.max(5, Number(ttlMinutes) || DEFAULT_TTL_MINUTES);

  const { rows: candidates } = await pool.query(
    `SELECT o.id, o.order_number, o.payment_reference
       FROM orders o
      WHERE o.status = 'pending'
        AND o.payment_status = 'unpaid'
        AND COALESCE(o.payment_method, 'paystack') = 'paystack'
        AND o.created_at < NOW() - ($1::int * INTERVAL '1 minute')
        AND NOT EXISTS (
          SELECT 1 FROM payments p
           WHERE p.order_id = o.id
             AND p.status IN ('paid', 'success', 'refund_pending', 'refunded')
        )
      ORDER BY o.created_at ASC
      LIMIT $2`,
    [safeTtl, BATCH_LIMIT]
  );

  let expiredCount = 0;
  let paidRecoveredCount = 0;
  let skippedVerifyErrorCount = 0;

  for (const candidate of candidates) {
    // 1. Collect any Paystack references associated with this order
    const { rows: payRefs } = await pool.query(
      `SELECT paystack_reference
         FROM payments
        WHERE order_id = $1 AND paystack_reference IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 3`,
      [candidate.id]
    );
    const refs = [...new Set([
      ...payRefs.map(r => r.paystack_reference),
      ...(candidate.payment_reference ? [candidate.payment_reference] : []),
    ].filter(Boolean))];

    // 2. Verify with Paystack before cancelling
    let skipDueToUncertainty = false;
    let recoveredAsPaid = false;

    for (const ref of refs) {
      try {
        const resp = await paystackClient.get(`/transaction/verify/${encodeURIComponent(ref)}`);
        const tx = resp?.data?.data;
        if (!tx || typeof tx.status !== 'string') {
          skipDueToUncertainty = true;
          break;
        }
        if (tx.status === 'success') {
          await processPaymentSuccess({
            data: {
              reference: ref,
              orderId: candidate.id,
              amountPesewas: tx.amount,
              currency: tx.currency || 'GHS',
            },
          }, boss);
          recoveredAsPaid = true;
          paidRecoveredCount++;
          break;
        }
      } catch (verifyErr) {
        logger.warn('Paystack verify failed during expiry check; skipping order', {
          orderId: candidate.id,
          reference: ref,
          err: verifyErr.message,
        });
        skipDueToUncertainty = true;
        break;
      }
    }

    if (recoveredAsPaid) continue;
    if (skipDueToUncertainty) {
      skippedVerifyErrorCount++;
      continue;
    }

    // 3. Atomic single-transaction expiry with FOR UPDATE SKIP LOCKED
    const client = await pool.connect();
    let txOpen = false;
    try {
      await client.query('BEGIN');
      txOpen = true;

      const { rows } = await client.query(
        `SELECT id, order_number, status, payment_status, coupon_code,
                stock_restored, coupon_returned
           FROM orders
          WHERE id = $1
            AND status = 'pending'
            AND payment_status = 'unpaid'
          FOR UPDATE SKIP LOCKED`,
        [candidate.id]
      );
      const order = rows[0];
      if (!order) {
        await client.query('ROLLBACK');
        txOpen = false;
        continue;
      }

      let stockRestored = Boolean(order.stock_restored);
      if (!stockRestored) {
        const { rows: items } = await client.query(
          `SELECT product_id, quantity, variant_id
             FROM order_items
            WHERE order_id = $1
            FOR UPDATE`,
          [order.id]
        );
        for (const item of items) {
          if (item.variant_id) {
            await VariantModel.adjustStock(item.variant_id, item.quantity, client);
          } else {
            await InventoryModel.adjustStock(
              item.product_id,
              item.quantity,
              'order_expired',
              `Restored from expired unpaid order ${order.order_number || order.id}`,
              client
            );
          }
        }
        stockRestored = true;
      }

      let couponReturned = Boolean(order.coupon_returned);
      if (order.coupon_code && !couponReturned) {
        await client.query(
          `UPDATE coupons
              SET uses_count = GREATEST(0, uses_count - 1),
                  updated_at = NOW()
            WHERE UPPER(code) = UPPER($1)`,
          [order.coupon_code]
        );
        couponReturned = true;
      }

      const reason = `Unpaid Paystack checkout expired after ${safeTtl} minutes`;
      await client.query(
        `UPDATE orders
            SET status = 'cancelled',
                cancelled_at = NOW(),
                cancellation_reason = $1,
                stock_restored = $2,
                coupon_returned = $3,
                updated_at = NOW()
          WHERE id = $4`,
        [reason, stockRestored, couponReturned, order.id]
      );

      await logStatusChange(order.id, 'pending', 'cancelled', reason, client);
      await client.query('COMMIT');
      txOpen = false;
      expiredCount++;
    } catch (err) {
      if (txOpen) {
        await client.query('ROLLBACK').catch(() => {});
      }
      logger.error('Failed to expire unpaid order', {
        orderId: candidate.id,
        err: err.message,
      });
    } finally {
      client.release();
    }
  }

  if (expiredCount > 0 || paidRecoveredCount > 0) {
    logger.info('Unpaid order expiry pass complete', {
      checked: candidates.length,
      expiredCount,
      paidRecoveredCount,
      skippedVerifyErrorCount,
      ttlMinutes: safeTtl,
    });
  }
  return {
    checked: candidates.length,
    expiredCount,
    paidRecoveredCount,
    skippedVerifyErrorCount,
  };
}

async function purgeCheckoutSessions() {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM checkout_sessions
        WHERE created_at < NOW() - INTERVAL '30 days'
           OR (recovered_order_id IS NOT NULL AND updated_at < NOW() - INTERVAL '24 hours')`
    );
    if (rowCount > 0) {
      logger.info('Purged expired/recovered checkout sessions', { purgedCount: rowCount });
    }
    return { purgedCount: rowCount || 0 };
  } catch (err) {
    logger.warn('Failed to purge checkout sessions', { err: err.message });
    return { purgedCount: 0 };
  }
}

async function register(boss) {
  await boss.createQueue('orders-expire-unpaid');
  await boss.work('orders-expire-unpaid', { teamSize: 1 }, async () => {
    await expireUnpaidOrders({ boss });
    await purgeCheckoutSessions();
  });

  await boss.schedule('orders-expire-unpaid', '*/5 * * * *', {}, {
    retryLimit: 1,
    retryDelay: 30,
    expireInSeconds: 180,
  });

  logger.info('Unpaid order expiry worker registered (every 5 min)', {
    ttlMinutes: DEFAULT_TTL_MINUTES,
  });
}

register.expireUnpaidOrders = expireUnpaidOrders;
register.purgeCheckoutSessions = purgeCheckoutSessions;
module.exports = register;

'use strict';

const pool = require('../config/database');
const InventoryModel = require('../models/inventory.model');
const VariantModel = require('../models/variant.model');
const { logStatusChange } = require('../utils/audit');
const logger = require('../utils/logger');

const DEFAULT_TTL_MINUTES = parseInt(process.env.UNPAID_ORDER_TTL_MINUTES, 10) || 30;
const BATCH_LIMIT = 50;

/**
 * Cancel stale pending+unpaid Paystack orders older than ttlMinutes and
 * atomically restore product/variant stock and coupon usage.
 */
async function expireUnpaidOrders({ ttlMinutes = DEFAULT_TTL_MINUTES } = {}) {
  const safeTtl = Math.max(5, Number(ttlMinutes) || DEFAULT_TTL_MINUTES);

  const { rows: candidates } = await pool.query(
    `SELECT o.id
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

  for (const candidate of candidates) {
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
          FOR UPDATE`,
        [candidate.id]
      );
      const order = rows[0];
      if (!order || order.status !== 'pending' || order.payment_status !== 'unpaid') {
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

  if (expiredCount > 0) {
    logger.info('Expired unpaid Paystack orders', { expiredCount, ttlMinutes: safeTtl });
  }
  return { checked: candidates.length, expiredCount };
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
    await expireUnpaidOrders();
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

'use strict';

const pool = require('../config/database');
const { fetchRefundById, fetchRefundsByTransaction } = require('../services/paystack.service');
const { logStatusChange } = require('../utils/audit');
const logger = require('../utils/logger');

const BATCH_LIMIT = 100;

// ── Transactional helpers ─────────────────────────────────────────────────────

async function applyRefundSuccess(order, paystackRefund) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Re-read inside the transaction with FOR UPDATE so a concurrent webhook
    // delivery cannot write at the same time.
    const { rows } = await client.query(
      'SELECT status, refund_status FROM orders WHERE id = $1 FOR UPDATE',
      [order.id]
    );
    const current = rows[0];

    // success is terminal — webhook may have arrived and committed first.
    // Any non-pending state means this run is a no-op.
    if (!current || current.refund_status !== 'pending') {
      await client.query('ROLLBACK');
      return false;
    }

    await client.query(
      `UPDATE orders
          SET refund_status     = 'success',
              status            = 'refunded',
              payment_status    = 'refunded',
              refund_provider_id = COALESCE(refund_provider_id, $1),
              refund_reference  = COALESCE(refund_reference,  $2),
              refunded_at       = NOW(),
              updated_at        = NOW()
        WHERE id = $3`,
      [String(paystackRefund.id), paystackRefund.reference || null, order.id]
    );

    await logStatusChange(
      order.id,
      current.status,
      'refunded',
      'Paystack refund confirmed via reconciliation',
      client
    );

    await client.query('COMMIT');
    logger.info('Refund reconciliation: marked success', {
      orderId: order.id,
      paystackId: paystackRefund.id,
    });
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('Refund reconciliation: error applying success', {
      orderId: order.id,
      err: err.message,
    });
    return false;
  } finally {
    client.release();
  }
}

async function applyRefundFailed(order, paystackRefund) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT refund_status, refund_notes FROM orders WHERE id = $1 FOR UPDATE',
      [order.id]
    );
    const current = rows[0];

    // Never downgrade success; skip if already resolved by webhook.
    if (!current || current.refund_status !== 'pending') {
      await client.query('ROLLBACK');
      return false;
    }

    const note = [current.refund_notes, 'Paystack refund failed (reconciliation)']
      .filter(Boolean)
      .join('\n');

    await client.query(
      `UPDATE orders
          SET refund_status     = 'failed',
              refund_provider_id = COALESCE(refund_provider_id, $1),
              refund_reference  = COALESCE(refund_reference,  $2),
              refund_notes      = $3,
              updated_at        = NOW()
        WHERE id = $4`,
      [String(paystackRefund.id), paystackRefund.reference || null, note, order.id]
    );

    await client.query('COMMIT');
    logger.warn('Refund reconciliation: marked failed', {
      orderId: order.id,
      paystackId: paystackRefund.id,
    });
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('Refund reconciliation: error applying failure', {
      orderId: order.id,
      err: err.message,
    });
    return false;
  } finally {
    client.release();
  }
}

// ── Worker registration ───────────────────────────────────────────────────────

module.exports = async function register(boss) {
  await boss.createQueue('reconcile/refunds');

  await boss.work('reconcile/refunds', { teamSize: 1 }, async (_job) => {
    logger.info('Refund reconciliation started');
    let checked = 0, updated = 0, failed = 0, unmatched = 0;

    try {
      // Only Paystack-method refunds that are still pending.
      // LEFT JOIN on the confirmed payment row to get the transaction reference
      // needed for the fallback lookup path.
      const { rows: pending } = await pool.query(
        `SELECT o.id,
                o.status,
                o.refund_status,
                o.refund_provider_id,
                o.refund_notes,
                p.paystack_reference AS transaction_reference
           FROM orders o
           LEFT JOIN payments p
             ON p.order_id      = o.id
            AND p.payment_method = 'paystack'
            AND p.status         = 'success'
          WHERE o.refund_status  = 'pending'
            AND o.refund_method  = 'paystack'
          ORDER BY o.updated_at ASC
          LIMIT $1`,
        [BATCH_LIMIT]
      );

      logger.info('Refund reconciliation: pending refunds found', { count: pending.length });

      for (const order of pending) {
        checked++;
        let paystackRefund = null;

        try {
          // Primary lookup: provider ID is the Paystack refund's numeric ID
          if (order.refund_provider_id) {
            paystackRefund = await fetchRefundById(order.refund_provider_id);
          }
          // Fallback: look up all refunds on the original transaction
          if (!paystackRefund && order.transaction_reference) {
            const list = await fetchRefundsByTransaction(order.transaction_reference);
            paystackRefund = list[0] || null;
          }
        } catch (err) {
          logger.error('Refund reconciliation: Paystack API error', {
            orderId: order.id,
            err: err.message,
          });
          continue; // leave this order pending; retry next run
        }

        if (!paystackRefund) {
          unmatched++;
          logger.warn('Refund reconciliation: no Paystack refund record found', {
            orderId: order.id,
            refundProviderId: order.refund_provider_id,
          });
          continue;
        }

        const paystackStatus = paystackRefund.status;

        if (paystackStatus === 'processed') {
          if (await applyRefundSuccess(order, paystackRefund)) updated++;
        } else if (paystackStatus === 'failed') {
          if (await applyRefundFailed(order, paystackRefund)) failed++;
        } else {
          // pending or processing — Paystack is still working on it
          logger.info('Refund reconciliation: still in progress', {
            orderId: order.id,
            paystackStatus,
          });
        }
      }

      logger.info('Refund reconciliation complete', { checked, updated, failed, unmatched });
    } catch (err) {
      logger.error('Refund reconciliation error', { err: err.message });
      throw err;
    }
  });

  // Schedule after work is registered so the queue exists before the first fire.
  await boss.schedule('reconcile/refunds', '*/30 * * * *', {});

  logger.info('Refund reconciliation worker registered (every 30 min)');
};

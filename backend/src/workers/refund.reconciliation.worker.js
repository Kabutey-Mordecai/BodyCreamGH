'use strict';

const pool = require('../config/database');
const { fetchRefundById, fetchRefundsByTransaction } = require('../services/paystack.service');
const { logStatusChange } = require('../utils/audit');
const logger = require('../utils/logger');

const BATCH_LIMIT = 100;

// ── Transactional helpers ─────────────────────────────────────────────────────

async function applyRefundSuccess(order, paystackRefund, boss) {
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
    // Only pending or needs_attention refunds can transition to success.
    if (!current || !['pending', 'needs_attention'].includes(current.refund_status)) {
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

    await client.query(
      `UPDATE payments
          SET status = 'refunded',
              updated_at = NOW()
        WHERE order_id = $1
          AND status IN ('success', 'needs_review')`,
      [order.id]
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
    if (boss) {
      await boss.send(
        'notification/order-refunded',
        { orderId: order.id },
        { retryLimit: 3 }
      ).catch(err => logger.error('Refund reconciliation: failed to enqueue order-refunded notification', {
        orderId: order.id,
        err: err.message,
      }));
    }
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
    if (!current || !['pending', 'needs_attention'].includes(current.refund_status)) {
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

async function applyRefundNeedsAttention(order, paystackRefund, boss) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT status, refund_status, refund_notes FROM orders WHERE id = $1 FOR UPDATE',
      [order.id]
    );
    const current = rows[0];

    if (!current || current.refund_status !== 'pending') {
      await client.query('ROLLBACK');
      return false;
    }

    const note = [current.refund_notes, 'Paystack refund needs attention — customer account details required (reconciliation)']
      .filter(Boolean)
      .join('\n');

    await client.query(
      `UPDATE orders
          SET refund_status     = 'needs_attention',
              refund_provider_id = COALESCE(refund_provider_id, $1),
              refund_reference  = COALESCE(refund_reference,  $2),
              refund_notes      = $3,
              updated_at        = NOW()
        WHERE id = $4`,
      [String(paystackRefund.id), paystackRefund.reference || null, note, order.id]
    );

    await logStatusChange(
      order.id,
      current.status,
      current.status,
      'Paystack refund needs attention — customer account details required',
      client
    );

    await client.query('COMMIT');
    logger.warn('Refund reconciliation: marked needs_attention', {
      orderId: order.id,
      paystackId: paystackRefund.id,
    });
    if (boss) {
      const alertKey = `refund_needs_attention_${paystackRefund.id || order.id}`;
      await boss.send(
        'notification/admin-payment-alert',
        {
          orderId: order.id,
          alertKey,
          title: 'Paystack refund needs attention',
          detail: 'Paystack requires customer account details to complete this refund.',
        },
        { retryLimit: 3, singletonKey: alertKey }
      );
    }
    return true;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('Refund reconciliation: error applying needs_attention', {
      orderId: order.id,
      err: err.message,
    });
    return false;
  } finally {
    client.release();
  }
}

// ── Duplicate-payment refund reconciliation ───────────────────────────────────

const STALE_REFUND_PENDING_MS = 48 * 60 * 60 * 1000;

// ── Tier 1: Item-level return_requests refund reconciliation ──────────────────

async function reconcileReturnRequestRefunds(boss) {
  const { finalizeReturnRequestRefund, matchPaystackRefundByRefAndAmount } = require('../controllers/return.controller');
  let checked = 0, refunded = 0, failed = 0, staleAlerted = 0;

  const { rows: pendingReturns } = await pool.query(
    `SELECT rr.*, o.status AS order_status,
            (SELECT p.paystack_reference
               FROM payments p
              WHERE p.order_id = rr.order_id
                AND p.payment_method = 'paystack'
                AND p.status IN ('success', 'needs_review')
              ORDER BY CASE WHEN p.status = 'success' THEN 1 ELSE 2 END, p.updated_at DESC
              LIMIT 1) AS tx_reference
       FROM return_requests rr
       JOIN orders o ON o.id = rr.order_id
      WHERE rr.status = 'refund_pending'
        AND rr.refund_method = 'paystack'
      ORDER BY rr.updated_at ASC
      LIMIT $1`,
    [BATCH_LIMIT]
  );

  for (const row of pendingReturns) {
    checked++;
    const amountPesewas = Math.round(Number(row.refund_amount) * 100);
    const ageMs = row.updated_at ? Date.now() - new Date(row.updated_at).getTime() : 0;
    const isStale48h = ageMs > STALE_REFUND_PENDING_MS;

    let paystackRefund = null;
    try {
      if (row.refund_provider_id) {
        paystackRefund = await fetchRefundById(row.refund_provider_id);
      }
      if (!paystackRefund && row.tx_reference && row.refund_reference) {
        const list = await fetchRefundsByTransaction(row.tx_reference);
        paystackRefund = matchPaystackRefundByRefAndAmount(list, row.refund_reference, amountPesewas);
      }
    } catch (err) {
      logger.error('Return refund reconciliation: Paystack API error', { returnId: row.id, err: err.message });
      continue;
    }

    if (!paystackRefund) {
      if (isStale48h && boss) {
        const staleKey = `ret_refund_stale_48h_${row.id}`;
        await boss.send(
          'notification/admin-payment-alert',
          {
            orderId: row.order_id,
            alertKey: staleKey,
            title: 'Partial return refund stuck >48h',
            detail: `Return ${row.id.slice(0, 8)} (ref ${row.refund_reference || 'n/a'}, GHS ${Number(row.refund_amount).toFixed(2)}) has been refund_pending >48h with no matching Paystack refund.`,
          },
          { retryLimit: 3, singletonKey: staleKey }
        );
        staleAlerted++;
      }
      continue;
    }

    const status = String(paystackRefund.status || '').toLowerCase();
    const providerId = paystackRefund.id ? String(paystackRefund.id) : null;

    if (status === 'processed') {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: [locked] } = await client.query(
          `SELECT * FROM return_requests WHERE id = $1 AND status = 'refund_pending' FOR UPDATE`,
          [row.id]
        );
        if (locked) {
          await finalizeReturnRequestRefund(client, locked, {
            providerId,
            refundReference: row.refund_reference,
            notePrefix: 'Paystack partial return refund confirmed via reconciliation',
          });
          await client.query('COMMIT');
          refunded++;
        } else {
          await client.query('ROLLBACK');
        }
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('Return refund reconciliation: error marking refunded', { returnId: row.id, err: err.message });
      } finally {
        client.release();
      }
    } else if (status === 'failed') {
      const client = await pool.connect();
      let didFail = false;
      try {
        await client.query('BEGIN');
        const { rowCount } = await client.query(
          `UPDATE return_requests
              SET status = 'refund_failed',
                  refund_provider_id = COALESCE(refund_provider_id, $1),
                  updated_at = NOW()
            WHERE id = $2 AND status = 'refund_pending'`,
          [providerId, row.id]
        );
        if (rowCount > 0) {
          await logStatusChange(
            row.order_id,
            row.order_status,
            row.order_status,
            `Partial return refund failed on Paystack (return ${row.id.slice(0, 8)}, ref ${row.refund_reference || 'n/a'}) — retry available`,
            client
          );
          await client.query('COMMIT');
          didFail = true;
          failed++;
        } else {
          await client.query('ROLLBACK');
        }
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
      } finally {
        client.release();
      }
      if (didFail && boss) {
        const failKey = `ret_refund_failed_${row.id}_${providerId || row.refund_attempt}`;
        await boss.send(
          'notification/admin-payment-alert',
          {
            orderId: row.order_id,
            alertKey: failKey,
            title: 'Partial return refund failed',
            detail: `Paystack refund for return ${row.id.slice(0, 8)} (GHS ${Number(row.refund_amount).toFixed(2)}) failed. Retry from Admin Order Detail.`,
          },
          { retryLimit: 3, singletonKey: failKey }
        );
      }
    } else if (status === 'needs-attention' && boss) {
      const attnKey = `ret_refund_needs_attention_${row.id}_${providerId || 'na'}`;
      await boss.send(
        'notification/admin-payment-alert',
        {
          orderId: row.order_id,
          alertKey: attnKey,
          title: 'Partial return refund needs attention',
          detail: `Paystack refund #${providerId || 'n/a'} for return ${row.id.slice(0, 8)} requires customer account details.`,
        },
        { retryLimit: 3, singletonKey: attnKey }
      );
    } else if (isStale48h && boss) {
      const staleKey = `ret_refund_stale_48h_${row.id}`;
      await boss.send(
        'notification/admin-payment-alert',
        {
          orderId: row.order_id,
          alertKey: staleKey,
          title: 'Partial return refund stuck >48h',
          detail: `Return ${row.id.slice(0, 8)} (GHS ${Number(row.refund_amount).toFixed(2)}, provider status: ${status}) has been refund_pending >48h.`,
        },
        { retryLimit: 3, singletonKey: staleKey }
      );
      staleAlerted++;
    }
  }

  return { checked, refunded, failed, staleAlerted };
}

// ── Tier 2: Duplicate-payment refund reconciliation ───────────────────────────

async function reconcileDuplicatePaymentRefunds(boss) {
  let checked = 0, refunded = 0, reverted = 0, staleAlerted = 0;

  const { rows: pendingDupRefunds } = await pool.query(
    `SELECT p.id, p.order_id, p.amount, p.currency, p.paystack_reference, p.updated_at, o.status AS order_status
       FROM payments p
       JOIN orders o ON o.id = p.order_id
      WHERE p.status = 'refund_pending'
        AND p.payment_method = 'paystack'
        AND p.paystack_reference IS NOT NULL
      ORDER BY p.updated_at ASC
      LIMIT $1`,
    [BATCH_LIMIT]
  );

  for (const row of pendingDupRefunds) {
    checked++;
    const amountNum = Number(row.amount) || 0;
    const ageMs = row.updated_at ? Date.now() - new Date(row.updated_at).getTime() : 0;
    const isStale48h = ageMs > STALE_REFUND_PENDING_MS;

    let paystackRefund = null;
    try {
      const list = await fetchRefundsByTransaction(row.paystack_reference);
      paystackRefund = (list || [])[0] || null;
    } catch (err) {
      logger.error('Duplicate refund reconciliation: Paystack API error', {
        paymentId: row.id,
        orderId: row.order_id,
        err: err.message,
      });
      continue;
    }

    if (!paystackRefund) {
      if (isStale48h && boss) {
        const staleKey = `dup_refund_stale_48h_${row.paystack_reference}`;
        await boss.send(
          'notification/admin-payment-alert',
          {
            orderId: row.order_id,
            alertKey: staleKey,
            title: 'Duplicate payment refund stuck >48h',
            detail: `Duplicate payment ${row.paystack_reference} (${row.currency || 'GHS'} ${amountNum.toFixed(2)}) has been in refund_pending for over 48 hours with no matching Paystack refund record.`,
          },
          { retryLimit: 3, singletonKey: staleKey }
        );
        staleAlerted++;
      }
      continue;
    }
    const status = String(paystackRefund.status || '').toLowerCase();
    const refundRef = paystackRefund.id ? String(paystackRefund.id) : (paystackRefund.reference || 'unknown');

    if (status === 'processed') {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rowCount } = await client.query(
          `UPDATE payments SET status = 'refunded', updated_at = NOW()
            WHERE id = $1 AND status = 'refund_pending'`,
          [row.id]
        );
        if (rowCount > 0) {
          await logStatusChange(
            row.order_id,
            row.order_status,
            row.order_status,
            `Duplicate payment refund confirmed via reconciliation (ref ${row.paystack_reference}, ${row.currency || 'GHS'} ${amountNum.toFixed(2)}, Paystack refund #${refundRef})`,
            client
          );
          await client.query('COMMIT');
          refunded++;
        } else {
          await client.query('ROLLBACK');
        }
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('Duplicate refund reconciliation: error marking refunded', { paymentId: row.id, err: err.message });
      } finally {
        client.release();
      }
    } else if (status === 'failed') {
      const client = await pool.connect();
      let didRevert = false;
      try {
        await client.query('BEGIN');
        const { rowCount } = await client.query(
          `UPDATE payments SET status = 'duplicate', updated_at = NOW()
            WHERE id = $1 AND status = 'refund_pending'`,
          [row.id]
        );
        if (rowCount > 0) {
          await logStatusChange(
            row.order_id,
            row.order_status,
            row.order_status,
            `Duplicate payment refund failed on Paystack (ref ${row.paystack_reference}, ${row.currency || 'GHS'} ${amountNum.toFixed(2)}, Paystack refund #${refundRef}) — reverted to duplicate for retry`,
            client
          );
          await client.query('COMMIT');
          didRevert = true;
          reverted++;
        } else {
          await client.query('ROLLBACK');
        }
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('Duplicate refund reconciliation: error reverting to duplicate', { paymentId: row.id, err: err.message });
      } finally {
        client.release();
      }

      if (didRevert && boss) {
        const failKey = `dup_refund_failed_${row.paystack_reference}_${refundRef}`;
        await boss.send(
          'notification/admin-payment-alert',
          {
            orderId: row.order_id,
            alertKey: failKey,
            title: 'Duplicate payment refund failed',
            detail: `Paystack refund #${refundRef} for duplicate payment ${row.paystack_reference} (${row.currency || 'GHS'} ${amountNum.toFixed(2)}) failed. Payment reverted to 'duplicate' for retry.`,
          },
          { retryLimit: 3, singletonKey: failKey }
        );
      }
    } else if (status === 'needs-attention' && boss) {
      const attnKey = `dup_refund_needs_attention_${row.paystack_reference}_${refundRef}`;
      await boss.send(
        'notification/admin-payment-alert',
        {
          orderId: row.order_id,
          alertKey: attnKey,
          title: 'Duplicate payment refund needs attention',
          detail: `Paystack refund #${refundRef} for duplicate payment ${row.paystack_reference} (${row.currency || 'GHS'} ${amountNum.toFixed(2)}) requires customer account details.`,
        },
        { retryLimit: 3, singletonKey: attnKey }
      );
    } else if (isStale48h && boss) {
      const staleKey = `dup_refund_stale_48h_${row.paystack_reference}`;
      await boss.send(
        'notification/admin-payment-alert',
        {
          orderId: row.order_id,
          alertKey: staleKey,
          title: 'Duplicate payment refund stuck >48h',
          detail: `Duplicate payment ${row.paystack_reference} (${row.currency || 'GHS'} ${amountNum.toFixed(2)}, Paystack refund #${refundRef}) has remained in refund_pending (provider status: ${status}) for over 48 hours.`,
        },
        { retryLimit: 3, singletonKey: staleKey }
      );
      staleAlerted++;
    }
  }

  return { checked, refunded, reverted, staleAlerted };
}

// ── Worker registration ───────────────────────────────────────────────────────

module.exports = async function register(boss) {
  await boss.createQueue('reconcile/refunds');

  await boss.work('reconcile/refunds', { teamSize: 1 }, async (_job) => {
    logger.info('Refund reconciliation started');
    let checked = 0, updated = 0, failed = 0, unmatched = 0;

    try {
      // Paystack-method refunds that are pending or awaiting customer details.
      // Correlated scalar subquery picks at most one transaction reference per order
      // (preferring 'success' over 'needs_review') for the fallback lookup path.
      const { rows: pending } = await pool.query(
        `SELECT o.id,
                o.status,
                o.refund_status,
                o.refund_provider_id,
                o.refund_notes,
                (
                  SELECT p.paystack_reference
                    FROM payments p
                   WHERE p.order_id       = o.id
                     AND p.payment_method = 'paystack'
                     AND p.status         IN ('success', 'needs_review')
                   ORDER BY CASE WHEN p.status = 'success' THEN 1 ELSE 2 END,
                            p.updated_at DESC
                   LIMIT 1
                ) AS transaction_reference
           FROM orders o
          WHERE o.refund_status  IN ('pending', 'needs_attention')
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
          if (await applyRefundSuccess(order, paystackRefund, boss)) updated++;
        } else if (paystackStatus === 'failed') {
          if (await applyRefundFailed(order, paystackRefund)) failed++;
        } else if (paystackStatus === 'needs-attention') {
          await applyRefundNeedsAttention(order, paystackRefund, boss);
        } else {
          // pending or processing — Paystack is still working on it
          logger.info('Refund reconciliation: still in progress', {
            orderId: order.id,
            paystackStatus,
          });
        }
      }

      const returnStats = await reconcileReturnRequestRefunds(boss);
      const dupStats = await reconcileDuplicatePaymentRefunds(boss);
      logger.info('Refund reconciliation complete', { checked, updated, failed, unmatched, returnRefunds: returnStats, duplicateRefunds: dupStats });
    } catch (err) {
      logger.error('Refund reconciliation error', { err: err.message });
      throw err;
    }
  });

  // Schedule after work is registered so the queue exists before the first fire.
  await boss.schedule('reconcile/refunds', '*/30 * * * *', {}, {
    retryLimit: 2,
    retryDelay: 120,
    retryBackoff: true,
    expireInSeconds: 300,
  });

  logger.info('Refund reconciliation worker registered (every 30 min)');
};

module.exports.reconcileReturnRequestRefunds = reconcileReturnRequestRefunds;
module.exports.reconcileDuplicatePaymentRefunds = reconcileDuplicatePaymentRefunds;

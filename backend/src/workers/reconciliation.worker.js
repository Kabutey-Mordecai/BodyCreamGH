const { randomUUID: uuid } = require('crypto');
const pool = require('../config/database');
const paystackAPI = require('../config/paystack');
const logger = require('../utils/logger');

const WINDOW_DAYS = parseInt(process.env.RECONCILE_WINDOW_DAYS, 10) || 7;
const PER_PAGE = 100;

module.exports = async function register(boss) {

  await boss.createQueue('reconcile');
  await boss.work('reconcile', { teamSize: 1 }, async (_job) => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - WINDOW_DAYS);
    const fromDate = cutoff.toISOString();

    logger.info('Payment reconciliation started', { windowDays: WINDOW_DAYS, from: fromDate });

    let page = 1;
    let totalChecked = 0;
    let totalFixed = 0;
    let cutoffReached = false;

    try {
      while (!cutoffReached) {
        logger.info('Reconciliation fetching page', { page, from: fromDate });

        const { data } = await paystackAPI.get('/transaction', {
          params: { status: 'success', perPage: PER_PAGE, page, from: fromDate },
        });

        const transactions = data?.data || [];
        const meta = data?.meta || {};

        if (transactions.length === 0) {
          logger.info('Reconciliation: empty page, stopping', { page });
          break;
        }

        let pageChecked = 0;
        let pageFixed = 0;

        for (const tx of transactions) {
          // Safety net: Paystack returns newest-first; stop if we drift past the window
          const paidAt = new Date(tx.paid_at || tx.created_at);
          if (paidAt < cutoff) {
            cutoffReached = true;
            logger.info('Reconciliation: date cutoff reached mid-page', {
              page,
              ref: tx.reference,
              paidAt: tx.paid_at,
            });
            break;
          }

          pageChecked++;

          const { rows } = await pool.query(
            `SELECT o.id, o.order_number, o.status, o.payment_status, o.payment_reference, o.total_amount,
                    p.status AS payment_row_status
               FROM payments p JOIN orders o ON p.order_id = o.id
              WHERE p.paystack_reference = $1`,
            [tx.reference]
          );

          if (!rows.length) {
            logger.warn('Reconciliation: Paystack transaction has no local payments row', {
              ref: tx.reference,
              amount: tx.amount,
              currency: tx.currency,
            });
            continue;
          }

          const order = rows[0];
          const paidPesewas = Number(tx.amount);
          const paidAmount  = Number.isFinite(paidPesewas) ? paidPesewas / 100 : 0;
          const txCurrency  = tx.currency || 'GHS';

          // Never re-process or alert on payment rows already marked refunded, needs_review, or duplicate.
          if (['refunded', 'needs_review', 'duplicate'].includes(order.payment_row_status)) {
            continue;
          }

          if (order.payment_status === 'paid' && order.payment_row_status === 'pending') {
            const { rows: successRows } = await pool.query(
              `SELECT paystack_reference FROM payments WHERE order_id = $1 AND status = 'success' LIMIT 1`,
              [order.id]
            );
            const winningRef = successRows[0]?.paystack_reference || order.payment_reference;
            if (winningRef && winningRef !== tx.reference) {
              const note = `Reconciliation: duplicate payment detected (ref ${tx.reference}, GHS ${paidAmount.toFixed(2)}) — order already paid via ${winningRef}. Admin refund required.`;
              const client = await pool.connect();
              let updatedCount = 0;
              try {
                await client.query('BEGIN');
                const { rowCount } = await client.query(
                  `UPDATE payments SET status = 'duplicate', amount = $2, updated_at = NOW()
                    WHERE paystack_reference = $1 AND status = 'pending'`,
                  [tx.reference, paidAmount]
                );
                updatedCount = rowCount;
                if (rowCount === 0) {
                  await client.query('ROLLBACK');
                  continue;
                }
                await client.query(
                  `INSERT INTO order_status_log (id, order_id, from_status, to_status, note, created_at)
                   VALUES ($1, $2, $3, $3, $4, NOW())`,
                  [uuid(), order.id, order.status, note]
                );
                await client.query('COMMIT');
              } catch (dbErr) {
                await client.query('ROLLBACK').catch(() => {});
                throw dbErr;
              } finally {
                client.release();
              }
              if (updatedCount > 0) {
                logger.error('Reconciliation: duplicate payment flagged', {
                  orderId: order.id, ref: tx.reference, winningRef, paidAmount,
                });
                await boss.send(
                  'notification/admin-payment-alert',
                  {
                    orderId: order.id,
                    alertKey: `duplicate_payment_${tx.reference}`,
                    title: 'Duplicate payment detected',
                    detail: note,
                  },
                  { retryLimit: 3 }
                );
                pageFixed++;
              }
            }
            continue;
          }

          if (order.payment_status === 'payment_review' && order.payment_row_status === 'pending') {
            const note = `Reconciliation: Paystack payment received for order already in payment_status="payment_review" (ref ${tx.reference}, GHS ${paidAmount.toFixed(2)}) — flagged for payment_review.`;
            const client = await pool.connect();
            let updatedReview = false;
            try {
              await client.query('BEGIN');
              const { rows: lockedRows } = await client.query(
                `SELECT status, payment_status FROM orders WHERE id = $1 FOR UPDATE`,
                [order.id]
              );
              const locked = lockedRows[0];
              if (!locked || locked.payment_status !== 'payment_review') {
                await client.query('ROLLBACK');
                continue;
              }
              const { rowCount } = await client.query(
                `UPDATE payments SET status = 'needs_review', amount = $2, updated_at = NOW()
                  WHERE paystack_reference = $1 AND status = 'pending'`,
                [tx.reference, paidAmount]
              );
              if (rowCount === 0) {
                await client.query('ROLLBACK');
                continue;
              }
              await client.query(
                `INSERT INTO order_status_log (id, order_id, from_status, to_status, note, created_at)
                 VALUES ($1, $2, $3, $3, $4, NOW())`,
                [uuid(), order.id, locked.status, note]
              );
              await client.query('COMMIT');
              updatedReview = true;
            } catch (dbErr) {
              await client.query('ROLLBACK').catch(() => {});
              throw dbErr;
            } finally {
              client.release();
            }
            if (updatedReview) {
              logger.error('Reconciliation: payment received on payment_review order', {
                orderId: order.id,
                ref: tx.reference,
                paidAmount,
              });
              await boss.send(
                'notification/admin-payment-alert',
                {
                  orderId: order.id,
                  alertKey: `review_order_payment_${tx.reference}`,
                  title: 'Payment received on payment_review order',
                  detail: note,
                },
                { retryLimit: 3 }
              );
              pageFixed++;
            }
            continue;
          }

          if (order.payment_status !== 'paid' && order.payment_status !== 'payment_review') {
            if (['cancelled', 'refunded'].includes(order.status)) {
              if (order.payment_row_status !== 'pending') continue;
              const note = `Reconciliation: Paystack payment received for ${order.status} order (ref ${tx.reference}, GHS ${paidAmount.toFixed(2)}) — flagged for payment_review.`;
              const client = await pool.connect();
              let updatedTerminal = false;
              try {
                await client.query('BEGIN');
                const { rows: lockedRows } = await client.query(
                  `SELECT status, payment_status FROM orders WHERE id = $1 FOR UPDATE`,
                  [order.id]
                );
                const locked = lockedRows[0];
                if (!locked || !['cancelled', 'refunded'].includes(locked.status) || locked.payment_status === 'payment_review') {
                  await client.query('ROLLBACK');
                  continue;
                }
                const { rowCount } = await client.query(
                  `UPDATE payments SET status = 'needs_review', amount = $2, updated_at = NOW()
                    WHERE paystack_reference = $1 AND status = 'pending'`,
                  [tx.reference, paidAmount]
                );
                if (rowCount === 0) {
                  await client.query('ROLLBACK');
                  continue;
                }
                await client.query(
                  `UPDATE orders SET payment_status = 'payment_review', updated_at = NOW()
                    WHERE id = $1 AND payment_status != 'payment_review'`,
                  [order.id]
                );
                await client.query(
                  `INSERT INTO order_status_log (id, order_id, from_status, to_status, note, created_at)
                   VALUES ($1, $2, $3, $3, $4, NOW())`,
                  [uuid(), order.id, locked.status, note]
                );
                await client.query('COMMIT');
                updatedTerminal = true;
              } catch (dbErr) {
                await client.query('ROLLBACK').catch(() => {});
                throw dbErr;
              } finally {
                client.release();
              }
              if (updatedTerminal) {
                logger.error('Reconciliation: Paystack payment matched terminal order — flagged for payment_review', {
                  orderId: order.id,
                  orderStatus: order.status,
                  ref: tx.reference,
                  paidAt: tx.paid_at,
                });
                await boss.send(
                  'notification/admin-payment-alert',
                  {
                    orderId: order.id,
                    alertKey: `terminal_payment_${tx.reference}`,
                    title: `Payment received on ${order.status} order`,
                    detail: note,
                  },
                  { retryLimit: 3 }
                );
                pageFixed++;
              }
              continue;
            }

            const expectedPesewas = Math.round(parseFloat(order.total_amount) * 100);

            if (txCurrency !== 'GHS' || !Number.isFinite(paidPesewas) || paidPesewas < expectedPesewas) {
              const reason = `Reconciliation mismatch (ref ${tx.reference}): expected ${expectedPesewas} GHS pesewas, got ${paidPesewas} ${txCurrency}`;
              const client = await pool.connect();
              let updatedMismatch = false;
              try {
                await client.query('BEGIN');
                const { rows: lockedRows } = await client.query(
                  `SELECT status, payment_status FROM orders WHERE id = $1 FOR UPDATE`,
                  [order.id]
                );
                const locked = lockedRows[0];
                if (
                  !locked ||
                  ['paid', 'refunded', 'payment_review'].includes(locked.payment_status) ||
                  ['cancelled', 'refunded'].includes(locked.status)
                ) {
                  await client.query('ROLLBACK');
                  continue;
                }
                const { rowCount } = await client.query(
                  `UPDATE payments SET status = 'needs_review', amount = $2, updated_at = NOW()
                    WHERE paystack_reference = $1 AND status = 'pending'`,
                  [tx.reference, paidAmount]
                );
                if (rowCount === 0) {
                  await client.query('ROLLBACK');
                  continue;
                }
                await client.query(
                  `UPDATE orders SET payment_status = 'payment_review', updated_at = NOW() WHERE id = $1`,
                  [order.id]
                );
                await client.query(
                  `INSERT INTO order_status_log (id, order_id, from_status, to_status, note, created_at)
                   VALUES ($1, $2, $3, $3, $4, NOW())`,
                  [uuid(), order.id, locked.status, reason]
                );
                await client.query('COMMIT');
                updatedMismatch = true;
              } catch (dbErr) {
                await client.query('ROLLBACK').catch(() => {});
                throw dbErr;
              } finally {
                client.release();
              }
              if (updatedMismatch) {
                logger.error('Reconciliation: amount or currency mismatch — flagged for payment_review', {
                  orderId: order.id,
                  ref: tx.reference,
                  expectedPesewas,
                  paidPesewas,
                  currency: txCurrency,
                });
              }
              continue;
            }

            logger.warn('Reconciliation: fixing missed payment', {
              orderId: order.id,
              ref: tx.reference,
              paidAt: tx.paid_at,
            });
            // payment.worker idempotency guards prevent double-processing
            await boss.send(
              'payment/payment.success',
              {
                reference: tx.reference,
                orderId: order.id,
                amount: paidAmount,
                amountPesewas: paidPesewas,
                currency: txCurrency,
              },
              { retryLimit: 3, retryBackoff: true }
            );
            logger.info('Reconciliation: fix enqueued', { orderId: order.id, ref: tx.reference });
            pageFixed++;
          }
        }

        totalChecked += pageChecked;
        totalFixed += pageFixed;

        logger.info('Reconciliation page complete', {
          page,
          pageChecked,
          pageFixed,
          pageCount: meta.pageCount,
        });

        // Partial page means this was the last page Paystack has in the window
        if (transactions.length < PER_PAGE) break;

        page++;
      }

      logger.info('Reconciliation complete', {
        totalChecked,
        totalFixed,
        pages: page,
        cutoffReached,
      });
    } catch (err) {
      logger.error('Reconciliation error', { err: err.message, page });
      throw err;
    }
  });

  // Schedule AFTER work is registered so the queue exists
  await boss.schedule('reconcile', '*/10 * * * *', {});

  logger.info('Reconciliation worker registered (every 10 min)');
};

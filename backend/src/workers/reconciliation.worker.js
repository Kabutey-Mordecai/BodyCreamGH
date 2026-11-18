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
            `SELECT o.id, o.status, o.payment_status, o.total_amount
               FROM payments p JOIN orders o ON p.order_id = o.id
              WHERE p.paystack_reference = $1`,
            [tx.reference]
          );

          if (!rows.length) {
            logger.debug('Reconciliation: no order for reference', { ref: tx.reference });
            continue;
          }

          const order = rows[0];
          if (order.payment_status !== 'paid' && order.payment_status !== 'payment_review') {
            // Terminal orders (cancelled / refunded) cannot be marked paid.
            // The payment worker would skip them anyway once it seals the jobsId,
            // creating an infinite loop. Skip here instead.
            if (['cancelled', 'refunded'].includes(order.status)) {
              logger.warn('Reconciliation: Paystack payment matched to terminal order — no action taken', {
                orderId: order.id,
                orderStatus: order.status,
                ref: tx.reference,
                paidAt: tx.paid_at,
              });
              continue;
            }

            const expectedPesewas = Math.round(parseFloat(order.total_amount) * 100);
            const paidPesewas     = Number(tx.amount);
            const txCurrency      = tx.currency || 'GHS';

            if (txCurrency !== 'GHS' || !Number.isFinite(paidPesewas) || paidPesewas < expectedPesewas) {
              const reason = `Reconciliation mismatch (ref ${tx.reference}): expected ${expectedPesewas} GHS pesewas, got ${paidPesewas} ${txCurrency}`;
              await pool.query(
                `UPDATE orders SET payment_status = 'payment_review', updated_at = NOW() WHERE id = $1`,
                [order.id]
              );
              await pool.query(
                `INSERT INTO order_status_log (id, order_id, from_status, to_status, note, created_at)
                 VALUES ($1, $2, $3, $3, $4, NOW())`,
                [require('crypto').randomUUID(), order.id, order.status, reason]
              );
              logger.error('Reconciliation: amount or currency mismatch — flagged for payment_review', {
                orderId: order.id,
                ref: tx.reference,
                expectedPesewas,
                paidPesewas,
                currency: txCurrency,
              });
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
                amount: paidPesewas / 100,
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

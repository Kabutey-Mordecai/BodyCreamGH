const { randomUUID: uuid } = require('crypto');
const pool = require('../config/database');
const InventoryModel = require('../models/inventory.model');
const VariantModel = require('../models/variant.model');
const { isProcessed, markProcessed } = require('../utils/idempotency');
const { assertTransition } = require('../utils/stateMachine');
const logger = require('../utils/logger');

async function processPaymentSuccess(jobs, boss = null) {
    const job = Array.isArray(jobs) ? jobs[0] : jobs;
    if (!job?.data) return;
    const { reference, orderId, amount, amountPesewas, currency } = job.data;
    const eventId = `payment_success_${reference}`;   // guards DB write
    const jobsId  = `payment_jobs_${reference}`;      // guards downstream sends

    // Fast path: DB updated AND downstream jobs confirmed sent.
    if (await isProcessed(jobsId)) {
      logger.info('Payment event fully processed, skipping', { reference, orderId });
      return;
    }

    const client = await pool.connect();
    let inTransaction = false;
    try {
      await client.query('BEGIN');
      inTransaction = true;

      const { rows } = await client.query(
        `SELECT id, order_number, status, payment_status, payment_reference, customer_id,
                total_amount, cancellation_reason, stock_restored, coupon_code, coupon_returned
           FROM orders WHERE id = $1 FOR UPDATE`,
        [orderId]
      );
      const order = rows[0];
      if (!order) throw new Error(`Order not found: ${orderId}`);

      const expectedPesewas = Math.round(parseFloat(order.total_amount) * 100);
      const paidPesewas = Number.isFinite(Number(amountPesewas))
        ? Number(amountPesewas)
        : Math.round(Number(amount) * 100);
      const paidAmount   = Number.isFinite(paidPesewas) ? paidPesewas / 100 : 0;
      const paidCurrency = currency || 'GHS';

      const { rows: payRows } = await client.query(
        `SELECT status FROM payments WHERE paystack_reference = $1 FOR UPDATE`,
        [reference]
      );
      const currentPayStatus = payRows[0]?.status;

      if (['refunded', 'needs_review', 'duplicate'].includes(currentPayStatus)) {
        await markProcessed(eventId, 'payment.handled_skip', client);
        await markProcessed(jobsId, 'payment.jobs', client);
        await client.query('COMMIT');
        inTransaction = false;
        return;

      } else if (currentPayStatus === 'success') {
        if (['cancelled', 'refunded'].includes(order.status) || ['payment_review', 'refunded'].includes(order.payment_status)) {
          await markProcessed(eventId, 'payment.terminal_review', client);
          await markProcessed(jobsId, 'payment.jobs', client);
          await client.query('COMMIT');
          inTransaction = false;
          return;
        }
        // Same reference replay — DB already updated, fall through to ensure downstream jobs were sent.
        await client.query('ROLLBACK');
        inTransaction = false;
        logger.info('Order payment already confirmed; re-attempting downstream jobs', { orderId, reference });

      } else if (['cancelled', 'refunded'].includes(order.status)) {
        const isAutoExpired =
          order.status === 'cancelled' &&
          String(order.cancellation_reason || '').startsWith('Unpaid Paystack checkout expired') &&
          order.stock_restored === true &&
          paidCurrency === 'GHS' &&
          paidPesewas >= expectedPesewas;

        let canRevive = false;
        let orderItems = [];
        if (isAutoExpired) {
          const { rows: items } = await client.query(
            `SELECT product_id, variant_id, quantity FROM order_items WHERE order_id = $1 FOR UPDATE`,
            [orderId]
          );
          orderItems = items;
          canRevive = items.length > 0;
          for (const item of items) {
            if (item.variant_id) {
              const { rows: vRows } = await client.query(
                `SELECT stock_quantity FROM product_variants WHERE id = $1 FOR UPDATE`,
                [item.variant_id]
              );
              if (!vRows[0] || vRows[0].stock_quantity < item.quantity) {
                canRevive = false;
                break;
              }
            } else {
              const { rows: pRows } = await client.query(
                `SELECT stock_quantity FROM products WHERE id = $1 FOR UPDATE`,
                [item.product_id]
              );
              if (!pRows[0] || pRows[0].stock_quantity < item.quantity) {
                canRevive = false;
                break;
              }
            }
          }
        }

        if (canRevive) {
          for (const item of orderItems) {
            if (item.variant_id) {
              await VariantModel.adjustStock(item.variant_id, -item.quantity, client);
            } else {
              await InventoryModel.adjustStock(
                item.product_id,
                -item.quantity,
                'order_revived',
                `Revived expired order ${order.order_number || order.id} on late Paystack payment`,
                client
              );
            }
          }
          if (order.coupon_code && order.coupon_returned) {
            await client.query(
              `UPDATE coupons SET uses_count = uses_count + 1, updated_at = NOW() WHERE UPPER(code) = UPPER($1)`,
              [order.coupon_code]
            );
          }
          await client.query(
            `UPDATE orders
                SET status = 'confirmed',
                    payment_status = 'paid',
                    payment_reference = $2,
                    stock_restored = FALSE,
                    coupon_returned = FALSE,
                    cancelled_at = NULL,
                    cancellation_reason = NULL,
                    updated_at = NOW()
              WHERE id = $1`,
            [orderId, reference]
          );
          await client.query(
            `UPDATE payments
                SET status = 'success', amount = $2, updated_at = NOW()
              WHERE paystack_reference = $1`,
            [reference, paidAmount]
          );
          await client.query(
            `INSERT INTO order_status_log (id, order_id, from_status, to_status, note, created_at)
             VALUES ($1, $2, 'cancelled', 'confirmed', $3, NOW())`,
            [uuid(), orderId, `Revived expired order on late Paystack charge.success (ref ${reference})`]
          );
          if (order.customer_id) {
            await client.query(
              `UPDATE customers SET total_spent = COALESCE(total_spent, 0) + $1, total_orders = COALESCE(total_orders, 0) + 1 WHERE user_id = $2`,
              [paidAmount, order.customer_id]
            );
          }
          await markProcessed(eventId, 'payment.revived', client);
          await client.query('COMMIT');
          inTransaction = false;
          logger.info('Revived expired unpaid order on late Paystack payment', { orderId, reference });
        } else {
          const note = `Paystack payment received for ${order.status} order (ref ${reference}, GHS ${paidAmount.toFixed(2)}) — flagged for payment_review (insufficient stock or manual cancellation).`;
          await client.query(
            `UPDATE orders SET payment_status = 'payment_review', updated_at = NOW() WHERE id = $1`,
            [orderId]
          );
          await client.query(
            `UPDATE payments SET status = 'needs_review', amount = $2, updated_at = NOW()
              WHERE paystack_reference = $1 AND status = 'pending'`,
            [reference, paidAmount]
          );
          await client.query(
            `INSERT INTO order_status_log (id, order_id, from_status, to_status, note, created_at)
             VALUES ($1, $2, $3, $3, $4, NOW())`,
            [uuid(), orderId, order.status, note]
          );
          await markProcessed(eventId, 'payment.terminal_review', client);
          await markProcessed(jobsId, 'payment.jobs', client);
          await client.query('COMMIT');
          inTransaction = false;

          logger.error('Payment received for terminal order — flagged for payment_review', {
            orderId, orderStatus: order.status, reference, paidAmount,
          });
          if (boss) {
            await boss.send(
              'notification/admin-payment-alert',
              {
                orderId,
                alertKey: `terminal_payment_${reference}`,
                title: `Payment received on ${order.status} order`,
                detail: note,
              },
              { retryLimit: 3 }
            );
          }
          return;
        }

      } else if (order.payment_status === 'paid') {
        const { rows: existingRows } = await client.query(
          `SELECT paystack_reference FROM payments WHERE order_id = $1 AND status = 'success' LIMIT 1`,
          [orderId]
        );
        const winningRef = existingRows[0]?.paystack_reference || order.payment_reference;

        if (winningRef && winningRef !== reference) {
          const note = `Duplicate Paystack payment detected (ref ${reference}, GHS ${paidAmount.toFixed(2)}) — order already paid via ${winningRef}. Admin refund required.`;
          await client.query(
            `UPDATE payments SET status = 'duplicate', amount = $2, updated_at = NOW()
              WHERE paystack_reference = $1 AND status != 'duplicate'`,
            [reference, paidAmount]
          );
          await client.query(
            `INSERT INTO order_status_log (id, order_id, from_status, to_status, note, created_at)
             VALUES ($1, $2, $3, $3, $4, NOW())`,
            [uuid(), orderId, order.status, note]
          );
          await markProcessed(eventId, 'payment.duplicate', client);
          await markProcessed(jobsId, 'payment.jobs', client);
          await client.query('COMMIT');
          inTransaction = false;

          logger.error('Payment worker: duplicate payment detected', {
            orderId, reference, winningRef, paidAmount,
          });
          await boss.send(
            'notification/admin-payment-alert',
            {
              orderId,
              alertKey: `duplicate_payment_${reference}`,
              title: 'Duplicate payment detected',
              detail: note,
            },
            { retryLimit: 3 }
          );
          return;
        }

        // Same reference replay — DB already updated, fall through to ensure downstream jobs were sent.
        await client.query('ROLLBACK');
        inTransaction = false;
        logger.info('Order already paid; re-attempting downstream jobs', { orderId, reference });

      } else if (['payment_review', 'refunded'].includes(order.payment_status)) {
        const note = `Paystack payment received for order already in payment_status="${order.payment_status}" (ref ${reference}, GHS ${paidAmount.toFixed(2)}) — flagged for payment_review.`;
        await client.query(
          `UPDATE payments SET status = 'needs_review', amount = $2, updated_at = NOW()
            WHERE paystack_reference = $1 AND status = 'pending'`,
          [reference, paidAmount]
        );
        await client.query(
          `INSERT INTO order_status_log (id, order_id, from_status, to_status, note, created_at)
           VALUES ($1, $2, $3, $3, $4, NOW())`,
          [uuid(), orderId, order.status, note]
        );
        await markProcessed(eventId, 'payment.review_conflict', client);
        await markProcessed(jobsId, 'payment.jobs', client);
        await client.query('COMMIT');
        inTransaction = false;

        logger.error('Payment worker: payment received on payment_review/refunded order', {
          orderId, paymentStatus: order.payment_status, reference, paidAmount,
        });
        await boss.send(
          'notification/admin-payment-alert',
          {
            orderId,
            alertKey: `review_order_payment_${reference}`,
            title: `Payment received on ${order.payment_status} order`,
            detail: note,
          },
          { retryLimit: 3 }
        );
        return;

      } else if (paidCurrency !== 'GHS' || !Number.isFinite(paidPesewas) || paidPesewas < expectedPesewas) {
        // Underpayment or wrong currency: do NOT mark paid or advance order status.
        // Move payment_status to 'payment_review', log alert, and seal without throwing
        // so pg-boss does not retry this permanent mismatch endlessly.
        const reason = `Payment review required (ref ${reference}): expected ${expectedPesewas} GHS pesewas, got ${paidPesewas} ${paidCurrency}`;
        await client.query(
          `UPDATE orders SET payment_status = 'payment_review', updated_at = NOW() WHERE id = $1`,
          [orderId]
        );
        await client.query(
          `UPDATE payments SET status = 'needs_review', amount = $2, updated_at = NOW()
            WHERE paystack_reference = $1 AND status = 'pending'`,
          [reference, paidAmount]
        );
        await client.query(
          `INSERT INTO order_status_log (id, order_id, from_status, to_status, note, created_at)
           VALUES ($1, $2, $3, $3, $4, NOW())`,
          [uuid(), orderId, order.status, reason]
        );
        await markProcessed(eventId, 'payment.mismatch', client);
        await markProcessed(jobsId, 'payment.jobs', client);
        await client.query('COMMIT');
        inTransaction = false;

        logger.error('Payment worker: underpayment or currency mismatch — flagged for payment_review', {
          orderId, reference, expectedPesewas, paidPesewas, currency: paidCurrency,
        });
        return;

      } else {
        // Exact match or overpayment (accept overpayment and flag for review).
        const needsStatusAdvance = order.status === 'pending';
        const isOverpaid         = paidPesewas > expectedPesewas;
        const diffPesewas        = paidPesewas - expectedPesewas;

        if (needsStatusAdvance) {
          assertTransition(order.status, 'confirmed');
        }

        await client.query(
          needsStatusAdvance
            ? `UPDATE orders SET payment_status = 'paid', status = 'confirmed', payment_reference = COALESCE(payment_reference, $2), updated_at = NOW() WHERE id = $1`
            : `UPDATE orders SET payment_status = 'paid', payment_reference = COALESCE(payment_reference, $2), updated_at = NOW() WHERE id = $1`,
          [orderId, reference]
        );
        await client.query(
          `UPDATE payments SET status = 'success', amount = $2, updated_at = NOW() WHERE paystack_reference = $1`,
          [reference, paidAmount]
        );
        if (needsStatusAdvance) {
          await client.query(
            `INSERT INTO order_status_log (id, order_id, from_status, to_status, note, created_at)
             VALUES ($1, $2, $3, 'confirmed', 'Payment confirmed via Paystack', NOW())`,
            [uuid(), orderId, order.status]
          );
        }
        if (isOverpaid) {
          const note = `Overpayment flagged for review (ref ${reference}): paid ${paidPesewas} pesewas vs expected ${expectedPesewas} pesewas (+${(diffPesewas / 100).toFixed(2)} GHS)`;
          await client.query(
            `INSERT INTO order_status_log (id, order_id, from_status, to_status, note, created_at)
             VALUES ($1, $2, $3, $3, $4, NOW())`,
            [uuid(), orderId, needsStatusAdvance ? 'confirmed' : order.status, note]
          );
          logger.warn('Payment worker: overpayment accepted and flagged for review', {
            orderId, reference, expectedPesewas, paidPesewas, diffPesewas,
          });
        }
        if (order.customer_id) {
          await client.query(
            `UPDATE customers SET total_spent = COALESCE(total_spent, 0) + $1, total_orders = COALESCE(total_orders, 0) + 1 WHERE user_id = $2`,
            [paidAmount, order.customer_id]
          );
        }
        await markProcessed(eventId, 'payment.success', client);
        await client.query('COMMIT');
        inTransaction = false;

        logger.info('Payment confirmed', { orderId, reference });
      }

      // Enqueue downstream jobs. Both receiving workers are idempotent, so
      // duplicate sends on retry are safe. Any throw here causes pg-boss to
      // retry this job; the already-paid branch above ensures the DB is not
      // touched again on that retry.
      if (boss) {
        await boss.send('shipment/create-shipment', { orderId }, { retryLimit: 3, retryBackoff: true });
        await boss.send('notification/payment-success', { orderId, reference }, { retryLimit: 3 });
      }

      // Completion seal — written last so a crash mid-send is retryable.
      await markProcessed(jobsId, 'payment.jobs');
      logger.info('Downstream jobs enqueued', { orderId, reference, jobs: ['create-shipment', 'payment-success'] });

    } catch (err) {
      if (inTransaction) await client.query('ROLLBACK').catch(() => {});
      logger.error('Payment worker failed', { err: err.message, orderId, reference });
      throw err; // pg-boss will retry
    } finally {
      client.release();
    }
}

async function register(boss) {
  await boss.createQueue('payment/payment.success');
  await boss.work('payment/payment.success', { teamSize: 5 }, (jobs) => processPaymentSuccess(jobs, boss));

  logger.info('Payment worker registered');
}

register.processPaymentSuccess = processPaymentSuccess;
module.exports = register;

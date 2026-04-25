const { v4: uuid } = require('uuid');
const pool = require('../config/database');
const { isProcessed, markProcessed } = require('../utils/idempotency');
const { assertTransition } = require('../utils/stateMachine');
const logger = require('../utils/logger');

module.exports = async function register(boss) {
  await boss.createQueue('payment/payment.success');
  await boss.work('payment/payment.success', { teamSize: 5 }, async (job) => {
    const { reference, orderId, amount } = job.data;
    const eventId = `payment_success_${reference}`;

    if (await isProcessed(eventId)) {
      logger.info('Duplicate payment event skipped', { reference, orderId });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        'SELECT id, status, payment_status, customer_id, total_amount FROM orders WHERE id = $1 FOR UPDATE',
        [orderId]
      );
      const order = rows[0];
      if (!order) throw new Error(`Order not found: ${orderId}`);

      if (order.payment_status === 'paid') {
        await client.query('ROLLBACK');
        logger.info('Order already paid, skipping', { orderId });
        return;
      }

      // Only advance to 'confirmed' if still 'pending'. If an admin already moved
      // the order forward, just mark payment as paid without touching the status.
      const needsStatusAdvance = order.status === 'pending';
      if (needsStatusAdvance) {
        assertTransition(order.status, 'confirmed');
      } else if (order.status === 'cancelled') {
        await client.query('ROLLBACK');
        logger.warn('Payment received for cancelled order', { orderId });
        return;
      }

      await client.query(
        needsStatusAdvance
          ? `UPDATE orders SET payment_status = 'paid', status = 'confirmed', updated_at = NOW() WHERE id = $1`
          : `UPDATE orders SET payment_status = 'paid', updated_at = NOW() WHERE id = $1`,
        [orderId]
      );
      await client.query(
        `UPDATE payments SET status = 'success', updated_at = NOW() WHERE paystack_reference = $1`,
        [reference]
      );
      if (needsStatusAdvance) {
        await client.query(
          `INSERT INTO order_status_log (id, order_id, from_status, to_status, note, created_at)
           VALUES ($1, $2, $3, 'confirmed', 'Payment confirmed via Paystack', NOW())`,
          [uuid(), orderId, order.status]
        );
      }
      await markProcessed(eventId, 'payment.success', client);
      await client.query('COMMIT');

      logger.info('Payment confirmed', { orderId, reference });

      // Non-critical: update customer totals outside the transaction
      if (order.customer_id) {
        pool.query(
          `UPDATE customers SET total_spent = total_spent + $1, total_orders = total_orders + 1 WHERE user_id = $2`,
          [amount, order.customer_id]
        ).catch(err => logger.error('Failed to update customer totals', { err: err.message }));
      }

      // Queue downstream work
      await boss.send('shipment/create-shipment', { orderId }, { retryLimit: 3, retryBackoff: true });
      await boss.send('notification/payment-success', { orderId, reference }, { retryLimit: 3 });

    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error('Payment worker failed', { err: err.message, orderId, reference });
      throw err; // pg-boss will retry
    } finally {
      client.release();
    }
  });

  logger.info('Payment worker registered');
};

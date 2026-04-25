const pool = require('../config/database');
const paystackAPI = require('../config/paystack');
const logger = require('../utils/logger');

module.exports = async function register(boss) {

  await boss.createQueue('reconcile');
  await boss.work('reconcile', { teamSize: 1 }, async (_job) => {
    logger.info('Payment reconciliation started');
    let checked = 0;
    let fixed = 0;

    try {
      const { data } = await paystackAPI.get('/transaction', {
        params: { status: 'success', perPage: 50 },
      });

      const transactions = data?.data || [];
      checked = transactions.length;

      for (const tx of transactions) {
        const { rows } = await pool.query(
          `SELECT o.id, o.payment_status
             FROM payments p JOIN orders o ON p.order_id = o.id
            WHERE p.paystack_reference = $1`,
          [tx.reference]
        );

        if (!rows.length) {
          logger.warn('Reconciliation: no order for reference', { ref: tx.reference });
          continue;
        }

        const order = rows[0];
        if (order.payment_status !== 'paid' && tx.status === 'success') {
          logger.warn('Reconciliation: fixing missed payment', { orderId: order.id, ref: tx.reference });
          await boss.send(
            'payment/payment.success',
            { reference: tx.reference, orderId: order.id, amount: tx.amount / 100 },
            { retryLimit: 3, retryBackoff: true }
          );
          fixed++;
        }
      }

      logger.info('Reconciliation complete', { checked, fixed });
    } catch (err) {
      logger.error('Reconciliation error', { err: err.message });
      throw err;
    }
  });

  // Schedule AFTER work is registered so the queue exists
  await boss.schedule('reconcile', '*/10 * * * *', {});

  logger.info('Reconciliation worker registered (every 10 min)');
};

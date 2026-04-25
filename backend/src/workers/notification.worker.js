const pool = require('../config/database');
const emailService = require('../services/email.service');
const logger = require('../utils/logger');

module.exports = async function register(boss) {

  await boss.createQueue('notification/payment-success');
  await boss.createQueue('notification/shipment-created');
  await boss.createQueue('notification/order-delivered');

  await boss.work('notification/payment-success', { teamSize: 10 }, async (job) => {
    const { orderId } = job.data;
    const { rows } = await pool.query(
      `SELECT o.order_number, o.total_amount,
              COALESCE(u.email, o.guest_email) AS email,
              COALESCE(u.first_name, 'Customer') AS first_name
         FROM orders o LEFT JOIN users u ON o.customer_id = u.id
        WHERE o.id = $1`, [orderId]
    );
    const row = rows[0];
    if (row?.email) {
      const { rows: items } = await pool.query(
        `SELECT p.name, oi.quantity, oi.price_at_purchase
           FROM order_items oi JOIN products p ON oi.product_id = p.id
          WHERE oi.order_id = $1`, [orderId]
      );
      await emailService.sendOrderConfirmation(row.email, {
        customerName: row.first_name,
        orderNumber:  row.order_number,
        total:        row.total_amount,
        items,
      });
      logger.info('Order confirmation email sent', { orderId });
    }
  });

  await boss.work('notification/shipment-created', { teamSize: 10 }, async (job) => {
    const { orderId, trackingNumber } = job.data;
    const { rows } = await pool.query(
      `SELECT o.order_number,
              COALESCE(u.email, o.guest_email) AS email,
              COALESCE(u.first_name, 'Customer') AS first_name
         FROM orders o LEFT JOIN users u ON o.customer_id = u.id
        WHERE o.id = $1`, [orderId]
    );
    const row = rows[0];
    if (row?.email) {
      await emailService.sendShippingNotification(row.email, {
        customerName:   row.first_name,
        orderNumber:    row.order_number,
        trackingNumber,
      });
      logger.info('Shipping notification sent', { orderId, trackingNumber });
    }
  });

  await boss.work('notification/order-delivered', { teamSize: 10 }, async (job) => {
    const { orderId } = job.data;
    const { rows: items } = await pool.query(
      `SELECT p.id AS product_id, p.name
         FROM order_items oi JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = $1`, [orderId]
    );
    const { rows: orderRows } = await pool.query(
      `SELECT o.order_number,
              COALESCE(u.email, o.guest_email) AS email,
              COALESCE(u.first_name, 'Customer') AS first_name
         FROM orders o LEFT JOIN users u ON o.customer_id = u.id
        WHERE o.id = $1`, [orderId]
    );
    const row = orderRows[0];
    if (row?.email && items.length > 0) {
      await emailService.sendReviewRequest(row.email, {
        customerName: row.first_name,
        orderNumber:  row.order_number,
        items,
        frontendUrl:  process.env.FRONTEND_URL || 'http://localhost:5173',
      });
      logger.info('Review request email sent', { orderId });
    }
  });

  logger.info('Notification workers registered');
};

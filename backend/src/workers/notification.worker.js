const pool = require('../config/database');
const emailService = require('../services/email.service');
const { isProcessed, markProcessed } = require('../utils/idempotency');
const logger = require('../utils/logger');

// Resolve admin notification email: DB setting first, env fallback.
// Queried once per job so a settings change takes effect on the next job without
// restarting the worker process.
async function getAdminEmail() {
  try {
    const { rows } = await pool.query(
      `SELECT value FROM site_settings WHERE key = 'order_notification_email'`
    );
    const dbEmail = rows[0]?.value?.trim();
    if (dbEmail) return dbEmail;
  } catch (err) {
    logger.warn('Failed to read admin email from settings, falling back to env', { err: err.message });
  }
  return process.env.ADMIN_EMAIL || null;
}

module.exports = async function register(boss) {

  await boss.createQueue('notification/payment-success');
  await boss.createQueue('notification/shipment-created');
  await boss.createQueue('notification/order-delivered');
  await boss.createQueue('notification/order-cancelled');
  await boss.createQueue('notification/order-refunded');
  await boss.createQueue('notification/cancel-requested');
  await boss.createQueue('notification/cancel-rejected');
  await boss.createQueue('notification/return-requested');
  await boss.createQueue('notification/return-rejected');

  // ── Payment confirmed ─────────────────────────────────────────────────────
  await boss.work('notification/payment-success', { teamSize: 10 }, async (jobs) => {
    const job = Array.isArray(jobs) ? jobs[0] : jobs;
    if (!job?.data) return;
    const { orderId, reference } = job.data;
    const eventId = `notification_payment_${reference}`;

    if (await isProcessed(eventId)) {
      logger.info('Payment notification already sent, skipping', { orderId, reference });
      return;
    }

    const { rows } = await pool.query(
      `SELECT o.order_number, o.total_amount,
              COALESCE(u.email, o.guest_email) AS email,
              COALESCE(u.first_name, 'Customer') AS first_name
         FROM orders o LEFT JOIN users u ON o.customer_id = u.id
        WHERE o.id = $1`, [orderId]
    );
    const row = rows[0];

    if (!row?.email) {
      logger.warn('[NOTIFICATION SKIP] Missing customer email', { orderId, event: 'payment-success' });
    } else {
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

    const admin = await getAdminEmail();
    if (!admin) {
      logger.warn('[NOTIFICATION SKIP] Missing admin email', { orderId, event: 'payment-success' });
    } else {
      await emailService.sendAdminNewOrder(admin, {
        orderNumber:  row?.order_number,
        total:        row?.total_amount,
        customerName: row?.first_name,
      });
      logger.info('Admin new-order alert sent', { orderId });
    }

    await markProcessed(eventId, 'notification.payment');
  });

  // ── Shipment created ──────────────────────────────────────────────────────
  await boss.work('notification/shipment-created', { teamSize: 10 }, async (jobs) => {
    const job = Array.isArray(jobs) ? jobs[0] : jobs;
    if (!job?.data) return;
    const { orderId, trackingNumber } = job.data;
    const eventId = `notification_shipment_${orderId}`;

    if (await isProcessed(eventId)) {
      logger.info('Shipment notification already sent, skipping', { orderId });
      return;
    }

    const { rows } = await pool.query(
      `SELECT o.order_number,
              COALESCE(u.email, o.guest_email) AS email,
              COALESCE(u.first_name, 'Customer') AS first_name
         FROM orders o LEFT JOIN users u ON o.customer_id = u.id
        WHERE o.id = $1`, [orderId]
    );
    const row = rows[0];

    if (!row?.email) {
      logger.warn('[NOTIFICATION SKIP] Missing customer email', { orderId, event: 'shipment-created' });
    } else {
      await emailService.sendShippingNotification(row.email, {
        customerName:   row.first_name,
        orderNumber:    row.order_number,
        trackingNumber,
      });
      logger.info('Shipping notification sent', { orderId, trackingNumber });
    }

    const admin = await getAdminEmail();
    if (!admin) {
      logger.warn('[NOTIFICATION SKIP] Missing admin email', { orderId, event: 'shipment-created' });
    } else {
      await emailService.sendAdminOrderShipped(admin, {
        orderNumber:    row?.order_number,
        trackingNumber,
      });
      logger.info('Admin shipment alert sent', { orderId });
    }

    await markProcessed(eventId, 'notification.shipment');
  });

  // ── Order delivered ───────────────────────────────────────────────────────
  await boss.work('notification/order-delivered', { teamSize: 10 }, async (jobs) => {
    const job = Array.isArray(jobs) ? jobs[0] : jobs;
    if (!job?.data) return;
    const { orderId } = job.data;
    const eventId = `notification_delivered_${orderId}`;

    if (await isProcessed(eventId)) {
      logger.info('Delivered notification already sent, skipping', { orderId });
      return;
    }

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

    if (!row?.email) {
      logger.warn('[NOTIFICATION SKIP] Missing customer email', { orderId, event: 'order-delivered' });
    } else if (items.length > 0) {
      await emailService.sendReviewRequest(row.email, {
        customerName: row.first_name,
        orderNumber:  row.order_number,
        items,
        frontendUrl:  process.env.FRONTEND_URL || 'http://localhost:5173',
      });
      logger.info('Review request email sent', { orderId });
    }

    const admin = await getAdminEmail();
    if (!admin) {
      logger.warn('[NOTIFICATION SKIP] Missing admin email', { orderId, event: 'order-delivered' });
    } else {
      await emailService.sendAdminOrderDelivered(admin, { orderNumber: row?.order_number });
      logger.info('Admin delivered alert sent', { orderId });
    }

    await markProcessed(eventId, 'notification.delivered');
  });

  // ── Order cancelled ───────────────────────────────────────────────────────
  await boss.work('notification/order-cancelled', { teamSize: 10 }, async (jobs) => {
    const job = Array.isArray(jobs) ? jobs[0] : jobs;
    if (!job?.data) return;
    const { orderId } = job.data;
    const eventId = `notification_cancelled_${orderId}`;

    if (await isProcessed(eventId)) {
      logger.info('Cancellation notification already sent, skipping', { orderId });
      return;
    }

    const { rows } = await pool.query(
      `SELECT o.order_number,
              COALESCE(u.email, o.guest_email) AS email,
              COALESCE(u.first_name, 'Customer') AS first_name
         FROM orders o LEFT JOIN users u ON o.customer_id = u.id
        WHERE o.id = $1`, [orderId]
    );
    const row = rows[0];

    if (!row?.email) {
      logger.warn('[NOTIFICATION SKIP] Missing customer email', { orderId, event: 'order-cancelled' });
    } else {
      await emailService.sendOrderCancellation(row.email, {
        customerName: row.first_name,
        orderNumber:  row.order_number,
      });
      logger.info('Cancellation notification sent', { orderId });
    }

    const admin = await getAdminEmail();
    if (!admin) {
      logger.warn('[NOTIFICATION SKIP] Missing admin email', { orderId, event: 'order-cancelled' });
    } else {
      await emailService.sendAdminOrderCancelled(admin, { orderNumber: row?.order_number });
      logger.info('Admin cancellation alert sent', { orderId });
    }

    await markProcessed(eventId, 'notification.cancelled');
  });

  // ── Order refunded ────────────────────────────────────────────────────────
  await boss.work('notification/order-refunded', { teamSize: 10 }, async (jobs) => {
    const job = Array.isArray(jobs) ? jobs[0] : jobs;
    if (!job?.data) return;
    const { orderId } = job.data;
    const eventId = `notification_refunded_${orderId}`;

    if (await isProcessed(eventId)) {
      logger.info('Refund notification already sent, skipping', { orderId });
      return;
    }

    const { rows } = await pool.query(
      `SELECT o.order_number, o.total_amount,
              COALESCE(u.email, o.guest_email) AS email,
              COALESCE(u.first_name, 'Customer') AS first_name
         FROM orders o LEFT JOIN users u ON o.customer_id = u.id
        WHERE o.id = $1`, [orderId]
    );
    const row = rows[0];

    if (!row?.email) {
      logger.warn('[NOTIFICATION SKIP] Missing customer email', { orderId, event: 'order-refunded' });
    } else {
      await emailService.sendRefundNotification(row.email, {
        customerName: row.first_name,
        orderNumber:  row.order_number,
        total:        row.total_amount,
      });
      logger.info('Refund notification sent', { orderId });
    }

    const admin = await getAdminEmail();
    if (!admin) {
      logger.warn('[NOTIFICATION SKIP] Missing admin email', { orderId, event: 'order-refunded' });
    } else {
      await emailService.sendAdminOrderRefunded(admin, {
        orderNumber: row?.order_number,
        total:       row?.total_amount,
      });
      logger.info('Admin refund alert sent', { orderId });
    }

    await markProcessed(eventId, 'notification.refunded');
  });

  // ── Cancel requested (customer → system) ─────────────────────────────────
  await boss.work('notification/cancel-requested', { teamSize: 10 }, async (jobs) => {
    const job = Array.isArray(jobs) ? jobs[0] : jobs;
    if (!job?.data) return;
    const { orderId } = job.data;
    const eventId = `notification_cancel_requested_${orderId}`;

    if (await isProcessed(eventId)) {
      logger.info('Cancel-requested notification already sent, skipping', { orderId });
      return;
    }

    const { rows } = await pool.query(
      `SELECT o.order_number, o.cancel_reason,
              COALESCE(u.email, o.guest_email) AS email,
              COALESCE(u.first_name, 'Customer') AS first_name
         FROM orders o LEFT JOIN users u ON o.customer_id = u.id
        WHERE o.id = $1`, [orderId]
    );
    const row = rows[0];

    if (!row?.email) {
      logger.warn('[NOTIFICATION SKIP] Missing customer email', { orderId, event: 'cancel-requested' });
    } else {
      await emailService.sendCancelRequested(row.email, {
        customerName: row.first_name,
        orderNumber:  row.order_number,
      });
      logger.info('Cancel-requested confirmation sent to customer', { orderId });
    }

    const admin = await getAdminEmail();
    if (!admin) {
      logger.warn('[NOTIFICATION SKIP] Missing admin email', { orderId, event: 'cancel-requested' });
    } else {
      await emailService.sendAdminCancelRequest(admin, {
        orderNumber:  row?.order_number,
        customerName: row?.first_name,
        reason:       row?.cancel_reason,
      });
      logger.info('Admin cancel-request alert sent', { orderId });
    }

    await markProcessed(eventId, 'notification.cancel-requested');
  });

  // ── Cancel rejected (admin decision) ─────────────────────────────────────
  await boss.work('notification/cancel-rejected', { teamSize: 10 }, async (jobs) => {
    const job = Array.isArray(jobs) ? jobs[0] : jobs;
    if (!job?.data) return;
    const { orderId } = job.data;
    const eventId = `notification_cancel_rejected_${orderId}`;

    if (await isProcessed(eventId)) {
      logger.info('Cancel-rejected notification already sent, skipping', { orderId });
      return;
    }

    const { rows } = await pool.query(
      `SELECT o.order_number,
              COALESCE(u.email, o.guest_email) AS email,
              COALESCE(u.first_name, 'Customer') AS first_name
         FROM orders o LEFT JOIN users u ON o.customer_id = u.id
        WHERE o.id = $1`, [orderId]
    );
    const row = rows[0];

    if (!row?.email) {
      logger.warn('[NOTIFICATION SKIP] Missing customer email', { orderId, event: 'cancel-rejected' });
    } else {
      await emailService.sendCancelRejected(row.email, {
        customerName: row.first_name,
        orderNumber:  row.order_number,
      });
      logger.info('Cancel-rejected notification sent to customer', { orderId });
    }

    const admin = await getAdminEmail();
    if (!admin) {
      logger.warn('[NOTIFICATION SKIP] Missing admin email', { orderId, event: 'cancel-rejected' });
    } else {
      await emailService.sendAdminCancelRejected(admin, { orderNumber: row?.order_number });
      logger.info('Admin cancel-rejection confirmation sent', { orderId });
    }

    await markProcessed(eventId, 'notification.cancel-rejected');
  });

  // ── Return requested (customer → system) ─────────────────────────────────
  await boss.work('notification/return-requested', { teamSize: 10 }, async (jobs) => {
    const job = Array.isArray(jobs) ? jobs[0] : jobs;
    if (!job?.data) return;
    const { orderId } = job.data;
    const eventId = `notification_return_requested_${orderId}`;

    if (await isProcessed(eventId)) {
      logger.info('Return-requested notification already sent, skipping', { orderId });
      return;
    }

    const { rows } = await pool.query(
      `SELECT o.order_number, o.return_reason,
              COALESCE(u.email, o.guest_email) AS email,
              COALESCE(u.first_name, 'Customer') AS first_name
         FROM orders o LEFT JOIN users u ON o.customer_id = u.id
        WHERE o.id = $1`, [orderId]
    );
    const row = rows[0];

    if (!row?.email) {
      logger.warn('[NOTIFICATION SKIP] Missing customer email', { orderId, event: 'return-requested' });
    } else {
      await emailService.sendReturnRequested(row.email, {
        customerName: row.first_name,
        orderNumber:  row.order_number,
      });
      logger.info('Return-requested confirmation sent to customer', { orderId });
    }

    const admin = await getAdminEmail();
    if (!admin) {
      logger.warn('[NOTIFICATION SKIP] Missing admin email', { orderId, event: 'return-requested' });
    } else {
      await emailService.sendAdminReturnRequest(admin, {
        orderNumber:  row?.order_number,
        customerName: row?.first_name,
        reason:       row?.return_reason,
      });
      logger.info('Admin return-request alert sent', { orderId });
    }

    await markProcessed(eventId, 'notification.return-requested');
  });

  // ── Return rejected (admin decision) ─────────────────────────────────────
  await boss.work('notification/return-rejected', { teamSize: 10 }, async (jobs) => {
    const job = Array.isArray(jobs) ? jobs[0] : jobs;
    if (!job?.data) return;
    const { orderId } = job.data;
    const eventId = `notification_return_rejected_${orderId}`;

    if (await isProcessed(eventId)) {
      logger.info('Return-rejected notification already sent, skipping', { orderId });
      return;
    }

    const { rows } = await pool.query(
      `SELECT o.order_number,
              COALESCE(u.email, o.guest_email) AS email,
              COALESCE(u.first_name, 'Customer') AS first_name
         FROM orders o LEFT JOIN users u ON o.customer_id = u.id
        WHERE o.id = $1`, [orderId]
    );
    const row = rows[0];

    if (!row?.email) {
      logger.warn('[NOTIFICATION SKIP] Missing customer email', { orderId, event: 'return-rejected' });
    } else {
      await emailService.sendReturnRejected(row.email, {
        customerName: row.first_name,
        orderNumber:  row.order_number,
      });
      logger.info('Return-rejected notification sent to customer', { orderId });
    }

    const admin = await getAdminEmail();
    if (!admin) {
      logger.warn('[NOTIFICATION SKIP] Missing admin email', { orderId, event: 'return-rejected' });
    } else {
      await emailService.sendAdminReturnRejected(admin, { orderNumber: row?.order_number });
      logger.info('Admin return-rejection confirmation sent', { orderId });
    }

    await markProcessed(eventId, 'notification.return-rejected');
  });

  logger.info('Notification workers registered');
};

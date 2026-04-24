const { v4: uuid }   = require('uuid');
const crypto         = require('crypto');
const pool           = require('../../config/database');
const OrderModel     = require('../../models/order.model');
const eventBus       = require('../eventBus');
const notify         = require('../../services/notification.service');

// Generate a human-readable, unique tracking number
function generateTrackingNumber() {
  const date   = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();      // 6 hex chars
  return `TRK-${date}-${suffix}`;
}

// Log the order status change to the audit table
async function logStatusChange(orderId, fromStatus, toStatus, note = null) {
  await pool.query(
    `INSERT INTO order_status_log (id, order_id, from_status, to_status, note)
     VALUES ($1, $2, $3, $4, $5)`,
    [uuid(), orderId, fromStatus, toStatus, note]
  ).catch(console.error);
}

/**
 * Handles the `payment.success` event.
 *
 * Flow:
 *   payment.success
 *     → log status change (pending/confirmed → processing)
 *     → create delivery record with auto-generated tracking number
 *     → emit shipment.created
 */
async function onPaymentSuccess({ orderId, orderNumber, email, amount }) {
  notify.paymentSuccess({ orderNumber, email, amount });

  try {
    // Fetch the current order status for the audit log
    const { rows: orderRows } = await pool.query(
      'SELECT status FROM orders WHERE id = $1',
      [orderId]
    );
    const fromStatus = orderRows[0]?.status || 'confirmed';

    // Advance order to processing
    await pool.query(
      `UPDATE orders SET status = 'processing', updated_at = NOW() WHERE id = $1 AND status != 'processing'`,
      [orderId]
    );
    await logStatusChange(orderId, fromStatus, 'processing', 'Payment confirmed via Paystack');
    notify.orderStatusChanged({ orderNumber, from: fromStatus, to: 'processing' });

    // Check whether a delivery record already exists (idempotency)
    const { rows: existing } = await pool.query(
      'SELECT id FROM deliveries WHERE order_id = $1',
      [orderId]
    );
    if (existing.length > 0) return; // already created — do nothing

    const trackingNumber = generateTrackingNumber();
    const deliveryId     = uuid();

    await pool.query(
      `INSERT INTO deliveries (id, order_id, status, tracking_number)
       VALUES ($1, $2, 'pending', $3)`,
      [deliveryId, orderId, trackingNumber]
    );

    notify.shipmentCreated({ orderNumber, trackingNumber, orderId });

    eventBus.emit('shipment.created', {
      deliveryId,
      orderId,
      orderNumber,
      trackingNumber,
      email,
    });
  } catch (err) {
    console.error('[payment.handler] onPaymentSuccess error:', err);
  }
}

module.exports = { onPaymentSuccess, logStatusChange };

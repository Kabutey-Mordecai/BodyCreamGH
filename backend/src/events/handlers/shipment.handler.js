const { v4: uuid } = require('uuid');
const pool         = require('../../config/database');
const notify       = require('../../services/notification.service');

// Audit log helper (duplicated here to avoid circular deps with payment.handler)
async function logStatusChange(orderId, fromStatus, toStatus, note = null) {
  await pool.query(
    `INSERT INTO order_status_log (id, order_id, from_status, to_status, note)
     VALUES ($1, $2, $3, $4, $5)`,
    [uuid(), orderId, fromStatus, toStatus, note]
  ).catch(console.error);
}

/**
 * shipment.created
 * Updates the order status to 'shipped' once a shipment is created.
 */
async function onShipmentCreated({ orderId, orderNumber, trackingNumber, manual }) {
  // When a delivery is created manually by an admin via the delivery controller,
  // that controller already updates the order status and logs the change itself.
  // Skipping here prevents a duplicate log entry.
  if (manual) return;
  try {
    const { rows } = await pool.query('SELECT status FROM orders WHERE id = $1', [orderId]);
    const from = rows[0]?.status || 'processing';

    await pool.query(
      `UPDATE orders SET status = 'shipped', updated_at = NOW()
       WHERE id = $1 AND status NOT IN ('shipped','delivered','cancelled')`,
      [orderId]
    );
    await logStatusChange(orderId, from, 'shipped', `Shipment created. Tracking: ${trackingNumber}`);
    notify.orderStatusChanged({ orderNumber: orderNumber || orderId, from, to: 'shipped' });
  } catch (err) {
    console.error('[shipment.handler] onShipmentCreated error:', err);
  }
}

/**
 * shipment.delivered
 * Marks both the delivery and order as delivered.
 */
async function onShipmentDelivered({ orderId, trackingNumber }) {
  try {
    const { rows } = await pool.query(
      `SELECT o.status, o.order_number FROM orders o WHERE o.id = $1`,
      [orderId]
    );
    if (!rows.length) return;

    const { status: from, order_number: orderNumber } = rows[0];

    await pool.query(
      `UPDATE orders SET status = 'delivered', updated_at = NOW() WHERE id = $1`,
      [orderId]
    );
    await logStatusChange(orderId, from, 'delivered', `Delivered. Tracking: ${trackingNumber}`);

    notify.shipmentDelivered({ trackingNumber, orderNumber });
    notify.orderStatusChanged({ orderNumber, from, to: 'delivered' });
  } catch (err) {
    console.error('[shipment.handler] onShipmentDelivered error:', err);
  }
}

module.exports = { onShipmentCreated, onShipmentDelivered };

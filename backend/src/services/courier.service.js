const pool           = require('../config/database');
const notify         = require('./notification.service');
const emailService   = require('./email.service');
const logger         = require('../utils/logger');
const { logStatusChange } = require('../utils/audit');

// Ordered shipment lifecycle
const SHIPMENT_FLOW = ['pending', 'in_transit', 'out_for_delivery', 'delivered'];

const STAGE_LABELS = {
  pending:          'Pending dispatch',
  in_transit:       'In transit',
  out_for_delivery: 'Out for delivery',
  delivered:        'Delivered',
};

// Returns the next status in the flow, or null if already at the end
function nextStatus(current) {
  const idx = SHIPMENT_FLOW.indexOf(current);
  return idx >= 0 && idx < SHIPMENT_FLOW.length - 1 ? SHIPMENT_FLOW[idx + 1] : null;
}

/**
 * Advance a shipment one step along the SHIPMENT_FLOW.
 * Logs every stage to order_status_log, syncs orders.status on delivered,
 * and dispatches customer SMS, FCM push, and email notifications.
 *
 * @param {string} trackingNumber
 * @returns {{ from, to, trackingNumber, orderId }} | { alreadyDelivered: true, ... }
 */
async function advanceShipment(trackingNumber) {
  const { rows } = await pool.query(
    'SELECT id, order_id, status FROM deliveries WHERE tracking_number = $1',
    [trackingNumber]
  );

  if (!rows.length) throw new Error(`No shipment found for tracking number: ${trackingNumber}`);

  const shipment = rows[0];
  const next = nextStatus(shipment.status);

  if (!next) {
    return { alreadyDelivered: true, current: shipment.status, trackingNumber };
  }

  await pool.query(
    `UPDATE deliveries
     SET status = $1, updated_at = NOW()
       ${next === 'delivered' ? ', actual_delivery_date = CURRENT_DATE' : ''}
     WHERE id = $2`,
    [next, shipment.id]
  );

  notify.shipmentUpdated({ trackingNumber, from: shipment.status, to: next });

  try {
    const { rows: orderRows } = await pool.query(
      `SELECT o.status, o.order_number, o.customer_id, o.total_amount,
              o.guest_email, o.guest_phone, o.fulfillment_method,
              u.email AS user_email, u.first_name, u.phone AS user_phone
         FROM orders o
         LEFT JOIN users u ON u.id = o.customer_id
        WHERE o.id = $1`,
      [shipment.order_id]
    );

    if (orderRows.length) {
      const ord = orderRows[0];
      const orderFrom = ord.status;
      const orderNumber = ord.order_number;
      const nextOrderStatus = next === 'delivered' ? 'delivered' : orderFrom;
      const stageNote = `Courier stage updated: ${STAGE_LABELS[next] || next} (Tracking: ${trackingNumber})`;

      if (next === 'delivered') {
        await pool.query(
          `UPDATE orders SET status = 'delivered', delivered_at = COALESCE(delivered_at, NOW()), updated_at = NOW() WHERE id = $1`,
          [shipment.order_id]
        );
        notify.shipmentDelivered({ trackingNumber, orderNumber });
        notify.orderStatusChanged({ orderNumber, from: orderFrom, to: 'delivered' });
      }

      await logStatusChange(shipment.order_id, orderFrom, nextOrderStatus, stageNote);

      // Best-effort customer alerts (SMS, FCM push, email on delivered)
      const phone = ord.user_phone || ord.guest_phone;
      const email = ord.user_email || ord.guest_email;
      const smsStatus = next === 'delivered' ? 'delivered' : 'shipped';

      if (phone) {
        notify.sendOrderStatusSms({
          phone,
          orderNumber,
          status: smsStatus,
          amount: ord.total_amount,
          courierNote: `${STAGE_LABELS[next] || next} · Tracking ${trackingNumber}`,
        }).catch(err => logger.warn('advanceShipment SMS error', { err: err.message }));
      }

      if (ord.customer_id) {
        notify.sendOrderStatusPush({
          userId: ord.customer_id,
          orderNumber,
          status: next === 'delivered' ? 'delivered' : 'shipped',
        }).catch(err => logger.warn('advanceShipment push error', { err: err.message }));
      }

      if (next === 'delivered' && email) {
        emailService.sendOrderStatusUpdate(email, {
          customerName:      ord.first_name || 'Valued Customer',
          orderNumber,
          status:            'delivered',
          fulfillmentMethod: ord.fulfillment_method,
          note:              stageNote,
        }).catch(err => logger.warn('advanceShipment email error', { err: err.message }));
      }
    }
  } catch (err) {
    logger.error('advanceShipment: failed to log/sync order stage', {
      err: err.message,
      orderId: shipment.order_id,
      trackingNumber,
    });
  }

  return { from: shipment.status, to: next, trackingNumber, orderId: shipment.order_id };
}

/**
 * Simulate the full courier journey in the background with realistic delays.
 * Useful for demo/testing without manual API calls.
 */
async function simulateFullJourney(trackingNumber, delayMs = 3000) {
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  for (let i = 0; i < SHIPMENT_FLOW.length - 1; i++) {
    await delay(delayMs);
    try {
      const result = await advanceShipment(trackingNumber);
      if (result?.alreadyDelivered) break;
    } catch (err) {
      logger.error('simulateFullJourney error', { err: err.message, trackingNumber });
      break;
    }
  }
}

module.exports = { advanceShipment, simulateFullJourney, SHIPMENT_FLOW };

const pool           = require('../config/database');
const notify         = require('./notification.service');
const logger         = require('../utils/logger');
const { logStatusChange } = require('../utils/audit');

// Ordered shipment lifecycle understood by this mock courier
const SHIPMENT_FLOW = ['pending', 'in_transit', 'out_for_delivery', 'delivered'];

// Returns the next status in the flow, or null if already at the end
function nextStatus(current) {
  const idx = SHIPMENT_FLOW.indexOf(current);
  return idx >= 0 && idx < SHIPMENT_FLOW.length - 1 ? SHIPMENT_FLOW[idx + 1] : null;
}

/**
 * Advance a shipment one step along the SHIPMENT_FLOW.
 * Called by the admin simulation endpoint or a timed job.
 *
 * @param {string} trackingNumber
 * @returns {{ from, to, trackingNumber, orderId }} | null if not found / already delivered
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

  if (next === 'delivered') {
    try {
      const { rows: orderRows } = await pool.query(
        'SELECT status, order_number FROM orders WHERE id = $1',
        [shipment.order_id]
      );
      if (orderRows.length) {
        const { status: orderFrom, order_number: orderNumber } = orderRows[0];
        await pool.query(
          `UPDATE orders SET status = 'delivered', delivered_at = COALESCE(delivered_at, NOW()), updated_at = NOW() WHERE id = $1`,
          [shipment.order_id]
        );
        await logStatusChange(shipment.order_id, orderFrom, 'delivered', `Courier delivered. Tracking: ${trackingNumber}`);
        notify.shipmentDelivered({ trackingNumber, orderNumber });
        notify.orderStatusChanged({ orderNumber, from: orderFrom, to: 'delivered' });
      }
    } catch (err) {
      logger.error('advanceShipment: failed to sync order status to delivered', {
        err: err.message,
        orderId: shipment.order_id,
        trackingNumber,
      });
    }
  }

  return { from: shipment.status, to: next, trackingNumber, orderId: shipment.order_id };
}

/**
 * Simulate the full courier journey in the background with realistic delays.
 * Useful for demo/testing without manual API calls.
 *
 * @param {string} trackingNumber
 * @param {number} delayMs - milliseconds between each status step (default 3 s)
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

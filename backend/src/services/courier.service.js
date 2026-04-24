const pool       = require('../config/database');
const eventBus   = require('../events/eventBus');
const notify     = require('./notification.service');

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

  // Emit generic update event
  eventBus.emit('shipment.updated', {
    deliveryId:     shipment.id,
    orderId:        shipment.order_id,
    trackingNumber,
    from:           shipment.status,
    to:             next,
  });

  // If we just delivered, emit the dedicated event
  if (next === 'delivered') {
    eventBus.emit('shipment.delivered', {
      deliveryId:     shipment.id,
      orderId:        shipment.order_id,
      trackingNumber,
    });
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
      console.error(`[courier] simulateFullJourney error: ${err.message}`);
      break;
    }
  }
}

module.exports = { advanceShipment, simulateFullJourney, SHIPMENT_FLOW };

// Notification service — in production this would dispatch to SMS, push, or email.
// For now it writes structured logs so the flow is clearly observable.

const LEVELS = { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' };

function log(level, event, payload) {
  const ts = new Date().toISOString();
  console.log(JSON.stringify({ ts, level, event, ...payload }));
}

const notify = {
  paymentSuccess({ orderNumber, email, amount }) {
    log(LEVELS.INFO, 'payment.success', {
      msg: `Payment confirmed for order ${orderNumber}`,
      email,
      amount: `GHS ${Number(amount).toFixed(2)}`,
    });
  },

  shipmentCreated({ orderNumber, trackingNumber, orderId }) {
    log(LEVELS.INFO, 'shipment.created', {
      msg: `Shipment created for order ${orderNumber}`,
      trackingNumber,
      orderId,
    });
  },

  shipmentUpdated({ trackingNumber, from, to }) {
    log(LEVELS.INFO, 'shipment.updated', {
      msg: `Shipment ${trackingNumber} moved: ${from} → ${to}`,
      trackingNumber,
      from,
      to,
    });
  },

  shipmentDelivered({ trackingNumber, orderNumber }) {
    log(LEVELS.INFO, 'shipment.delivered', {
      msg: `Order ${orderNumber} delivered. Tracking: ${trackingNumber}`,
      trackingNumber,
    });
  },

  orderStatusChanged({ orderNumber, from, to }) {
    log(LEVELS.INFO, 'order.status_changed', {
      msg: `Order ${orderNumber}: ${from} → ${to}`,
    });
  },
};

module.exports = notify;

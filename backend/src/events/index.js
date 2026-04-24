// Bootstrap: wire all eventBus listeners once at server startup.
// Import this file once in server.js — order of registration doesn't matter.

const eventBus                             = require('./eventBus');
const { onPaymentSuccess }                 = require('./handlers/payment.handler');
const { onShipmentCreated, onShipmentDelivered } = require('./handlers/shipment.handler');

eventBus.on('payment.success',    onPaymentSuccess);
eventBus.on('shipment.created',   onShipmentCreated);
eventBus.on('shipment.delivered', onShipmentDelivered);

console.log('[events] All event handlers registered');

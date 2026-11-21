const crypto      = require('crypto');
const { randomUUID: uuid } = require('crypto');
const pool         = require('../config/database');
const DeliveryModel = require('../models/delivery.model');
const OrderModel   = require('../models/order.model');
const notify       = require('../services/notification.service');
const { sendShippingNotification } = require('../services/email.service');
const { logStatusChange } = require('../utils/audit');
const { notificationQueue } = require('../queues');
const logger      = require('../utils/logger');

const VALID_DELIVERY_STATUSES = ['pending', 'in_transit', 'out_for_delivery', 'delivered'];

function generateTrackingNumber() {
  const date   = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `TRK-${date}-${suffix}`;
}

// Admin: create a delivery record for an order and mark it as shipped
const createDelivery = async (req, res) => {
  try {
    const {
      order_id, delivery_partner, tracking_number,
      estimated_delivery, driver_phone,
    } = req.body;

    if (!order_id) return res.status(400).json({ error: 'order_id is required' });

    const order = await OrderModel.findById(order_id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'cancelled') {
      return res.status(400).json({ error: 'Cannot ship a cancelled order' });
    }

    const existing = await DeliveryModel.findByOrderId(order_id);
    if (existing) return res.status(400).json({ error: 'Delivery already exists for this order' });

    const courierMode = (process.env.COURIER_MODE || (process.env.NODE_ENV === 'production' ? 'manual' : 'mock')).trim().toLowerCase();
    const providedTracking = typeof tracking_number === 'string' ? tracking_number.trim() : '';
    if (courierMode === 'manual' && !providedTracking) {
      return res.status(400).json({ error: 'tracking_number is required when COURIER_MODE=manual' });
    }
    const finalTracking = providedTracking || generateTrackingNumber();

    const deliveryId = await DeliveryModel.create({
      orderId:          order_id,
      deliveryPartner:  delivery_partner,
      trackingNumber:   finalTracking,
      estimatedDelivery: estimated_delivery,
      driverPhone:      driver_phone,
    });

    // Mark order as shipped and log the change
    const prevStatus = order.status;
    await OrderModel.updateStatus(order_id, 'shipped');
    await logStatusChange(order_id, prevStatus, 'shipped', `Manual delivery created. Tracking: ${finalTracking}`);

    // Notify customer
    const emailAddress = order.email || order.user_email;
    sendShippingNotification(emailAddress, {
      orderNumber:     order.order_number,
      trackingNumber:  finalTracking,
      deliveryPartner: delivery_partner,
    }).catch(err => logger.error('sendShippingNotification error', { err: err.message }));

    notify.shipmentCreated({ orderNumber: order.order_number, trackingNumber: finalTracking, orderId: order_id });

    res.status(201).json({
      deliveryId,
      trackingNumber: finalTracking,
      message: 'Delivery created and order marked as shipped',
    });
  } catch (error) {
    logger.error('Create delivery error', { err: error.message });
    res.status(500).json({ error: 'Failed to create delivery' });
  }
};

// Public: track a shipment by tracking number — no auth required
const trackShipment = async (req, res) => {
  try {
    const { tracking_number } = req.params;
    const { rows } = await pool.query(
      `SELECT d.*,
              o.order_number, o.status AS order_status, o.created_at AS order_placed_at,
              o.shipping_city, o.shipping_region
         FROM deliveries d
         JOIN orders o ON o.id = d.order_id
        WHERE d.tracking_number = $1`,
      [tracking_number]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Tracking number not found' });
    }

    const d = rows[0];
    res.json({
      tracking_number:    d.tracking_number,
      status:             d.status,
      delivery_partner:   d.delivery_partner,
      estimated_delivery: d.estimated_delivery,
      actual_delivery:    d.actual_delivery_date,
      order: {
        order_number:   d.order_number,
        status:         d.order_status,
        placed_at:      d.order_placed_at,
        destination: [d.shipping_city, d.shipping_region]
          .filter(Boolean).join(', '),
      },
      timeline: buildTimeline(d),
    });
  } catch (error) {
    logger.error('Track shipment error', { err: error.message });
    res.status(500).json({ error: 'Failed to track shipment' });
  }
};

// Build a simple visual timeline for the tracking response
function buildTimeline(delivery) {
  const statuses = ['pending', 'in_transit', 'out_for_delivery', 'delivered'];
  const labels   = {
    pending:           'Order packed & ready',
    in_transit:        'In transit to destination',
    out_for_delivery:  'Out for delivery',
    delivered:         'Delivered',
  };
  const idx = statuses.indexOf(delivery.status);
  return statuses.map((s, i) => ({
    status:    s,
    label:     labels[s],
    completed: i <= idx,
    current:   i === idx,
  }));
}

// Get delivery info for an order (admin or the order's customer)
const getDeliveryByOrder = async (req, res) => {
  try {
    const { orderId } = req.params;

    if (req.user.role !== 'admin') {
      const order = await OrderModel.findById(orderId, req.user.id);
      if (!order) return res.status(404).json({ error: 'Order not found' });
    }

    const delivery = await DeliveryModel.findByOrderId(orderId);
    if (!delivery) return res.status(404).json({ error: 'No delivery record found for this order' });

    res.json(delivery);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch delivery' });
  }
};

// Admin: update delivery status or tracking info
const updateDelivery = async (req, res) => {
  try {
    const { deliveryId } = req.params;
    const { status, tracking_number, estimated_delivery, actual_delivery_date, driver_phone, delivery_partner } = req.body;

    if (status && !VALID_DELIVERY_STATUSES.includes(status)) {
      return res.status(400).json({
        error: `Status must be one of: ${VALID_DELIVERY_STATUSES.join(', ')}`,
      });
    }

    // Fetch current state for event emission
    const { rows: before } = await pool.query(
      'SELECT status, order_id, tracking_number FROM deliveries WHERE id = $1',
      [deliveryId]
    );
    if (!before.length) return res.status(404).json({ error: 'Delivery not found' });

    const prev = before[0];

    await DeliveryModel.update(deliveryId, {
      status,
      trackingNumber:      tracking_number,
      estimatedDelivery:   estimated_delivery,
      actualDeliveryDate:  actual_delivery_date,
      driverPhone:         driver_phone,
      deliveryPartner:     delivery_partner,
    });

    if (status && status !== prev.status) {
      const tn = tracking_number || prev.tracking_number;
      notify.shipmentUpdated({ trackingNumber: tn, from: prev.status, to: status });

      if (status === 'delivered') {
        const { rows: orderRows } = await pool.query(
          'SELECT status, order_number FROM orders WHERE id = $1',
          [prev.order_id]
        );
        if (orderRows.length) {
          const { status: orderFrom, order_number: orderNumber } = orderRows[0];
          await pool.query(
            `UPDATE orders SET status = 'delivered', delivered_at = COALESCE(delivered_at, NOW()), updated_at = NOW() WHERE id = $1`,
            [prev.order_id]
          );
          await logStatusChange(prev.order_id, orderFrom, 'delivered', `Delivered. Tracking: ${tn}`);
          notify.shipmentDelivered({ trackingNumber: tn, orderNumber });
          notify.orderStatusChanged({ orderNumber, from: orderFrom, to: 'delivered' });
          await notificationQueue
            .add('order-delivered', { orderId: prev.order_id }, { attempts: 3 })
            .catch(err => logger.error('Failed to queue order-delivered notification', { err: err.message, orderId: prev.order_id }));
        }
      }
    }

    res.json({ message: 'Delivery updated' });
  } catch (error) {
    logger.error('Update delivery error', { err: error.message });
    res.status(500).json({ error: 'Failed to update delivery' });
  }
};

module.exports = { createDelivery, trackShipment, getDeliveryByOrder, updateDelivery };

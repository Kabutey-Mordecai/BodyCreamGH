const pool = require('../config/database');
const DeliveryModel = require('../models/delivery.model');
const OrderModel = require('../models/order.model');
const { sendShippingNotification } = require('../services/email.service');

// Admin: create a delivery record for an order and mark it as shipped
const createDelivery = async (req, res) => {
  try {
    const { order_id, delivery_partner, tracking_number, estimated_delivery, driver_phone } = req.body;

    if (!order_id) return res.status(400).json({ error: 'order_id is required' });

    const order = await OrderModel.findById(order_id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'cancelled') {
      return res.status(400).json({ error: 'Cannot ship a cancelled order' });
    }

    const existing = await DeliveryModel.findByOrderId(order_id);
    if (existing) return res.status(400).json({ error: 'Delivery already exists for this order' });

    const deliveryId = await DeliveryModel.create({
      orderId: order_id,
      deliveryPartner: delivery_partner,
      trackingNumber: tracking_number,
      estimatedDelivery: estimated_delivery,
      driverPhone: driver_phone,
    });

    // Mark order as shipped
    await OrderModel.updateStatus(order_id, 'shipped');

    // Notify the customer
    sendShippingNotification(order.customer_email, {
      orderNumber: order.order_number,
      trackingNumber: tracking_number,
      deliveryPartner: delivery_partner,
    }).catch(console.error);

    res.status(201).json({ deliveryId, message: 'Delivery created and order marked as shipped' });
  } catch (error) {
    console.error('Create delivery error:', error);
    res.status(500).json({ error: 'Failed to create delivery' });
  }
};

// Get delivery info for an order (admin or the order's customer)
const getDeliveryByOrder = async (req, res) => {
  try {
    const { orderId } = req.params;

    // Customers can only see their own orders
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
    const { status, tracking_number, estimated_delivery, actual_delivery_date, driver_phone } = req.body;

    const validStatuses = ['pending', 'in_transit', 'delivered'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
    }

    await DeliveryModel.update(deliveryId, {
      status,
      trackingNumber: tracking_number,
      estimatedDelivery: estimated_delivery,
      actualDeliveryDate: actual_delivery_date,
      driverPhone: driver_phone,
    });

    // If delivered, mark the order as delivered too
    if (status === 'delivered') {
      const { rows } = await pool.query('SELECT order_id FROM deliveries WHERE id=$1', [deliveryId]);
      if (rows.length > 0) {
        await OrderModel.updateStatus(rows[0].order_id, 'delivered');
      }
    }

    res.json({ message: 'Delivery updated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update delivery' });
  }
};

module.exports = { createDelivery, getDeliveryByOrder, updateDelivery };

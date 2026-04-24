const { v4: uuid } = require('uuid');
const pool = require('../config/database');
const OrderModel = require('../models/order.model');
const InventoryModel = require('../models/inventory.model');

const createOrder = async (req, res) => {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    const { shipping_address, shipping_city, shipping_region, notes } = req.body;
    let { delivery_fee = 0 } = req.body;

    if (!shipping_address || !shipping_city || !shipping_region) {
      return res.status(400).json({ error: 'Shipping address, city, and region are required' });
    }

    delivery_fee = parseFloat(delivery_fee);
    if (isNaN(delivery_fee) || delivery_fee < 0) {
      return res.status(400).json({ error: 'delivery_fee must be a non-negative number' });
    }

    // BEGIN before the cart fetch so the entire operation is one atomic unit
    await client.query('BEGIN');
    transactionStarted = true;

    // Lock the cart rows to prevent concurrent modifications
    const cartResult = await client.query(
      `SELECT ci.quantity, p.id as product_id, p.price, p.stock_quantity
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       WHERE ci.customer_id = $1
       FOR UPDATE`,
      [req.user.id]
    );

    if (cartResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cart is empty' });
    }

    // Validate stock for every item before writing anything
    for (const item of cartResult.rows) {
      if (item.stock_quantity < item.quantity) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Insufficient stock for one or more items' });
      }
    }

    let subtotal = 0;
    cartResult.rows.forEach(item => { subtotal += parseFloat(item.price) * item.quantity; });
    const total = subtotal + delivery_fee;

    const orderId = uuid();
    const orderNumber = `ORD-${Date.now()}`;

    await client.query(
      `INSERT INTO orders
         (id, customer_id, order_number, total_amount, shipping_address, shipping_city,
          shipping_region, delivery_fee, notes, status, payment_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending','unpaid')`,
      [orderId, req.user.id, orderNumber, total, shipping_address, shipping_city,
       shipping_region, delivery_fee, notes]
    );

    for (const item of cartResult.rows) {
      await client.query(
        'INSERT INTO order_items (id, order_id, product_id, quantity, price_at_purchase, subtotal) VALUES ($1,$2,$3,$4,$5,$6)',
        [uuid(), orderId, item.product_id, item.quantity, item.price,
         parseFloat(item.price) * item.quantity]
      );
      await InventoryModel.adjustStock(item.product_id, -item.quantity, 'sale', null, client);
    }

    await client.query('DELETE FROM cart_items WHERE customer_id=$1', [req.user.id]);
    await client.query('COMMIT');

    res.status(201).json({ orderId, orderNumber, total });
  } catch (error) {
    // Only ROLLBACK if we actually opened a transaction
    if (transactionStarted) {
      await client.query('ROLLBACK').catch(() => {});
    }
    console.error('Error creating order:', error);
    res.status(500).json({ error: 'Failed to create order' });
  } finally {
    client.release();
  }
};

const getOrders = async (req, res) => {
  try {
    res.json(await OrderModel.findByCustomer(req.user.id));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
};

const getOrderById = async (req, res) => {
  try {
    const order = await OrderModel.findById(req.params.orderId, req.user.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const items = await OrderModel.getItems(req.params.orderId);
    res.json({ order, items });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch order' });
  }
};

const getAllOrders = async (req, res) => {
  try {
    res.json(await OrderModel.findAll());
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
};

const updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['pending', 'paid', 'shipped', 'delivered', 'cancelled'];
    if (!valid.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${valid.join(', ')}` });
    }
    await OrderModel.updateStatus(req.params.orderId, status);
    res.json({ message: 'Order status updated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update order status' });
  }
};

module.exports = { createOrder, getOrders, getOrderById, getAllOrders, updateOrderStatus };

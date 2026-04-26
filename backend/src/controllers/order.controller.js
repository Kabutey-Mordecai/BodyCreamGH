const { v4: uuid } = require('uuid');
const pool = require('../config/database');
const OrderModel = require('../models/order.model');
const InventoryModel = require('../models/inventory.model');
const ReviewModel = require('../models/review.model');
const CouponModel = require('../models/coupon.model');
const { logStatusChange } = require('../utils/audit');
const { assertTransition } = require('../utils/stateMachine');
const { createFullRefund } = require('../services/paystack.service');
const logger = require('../utils/logger');

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
    let total = subtotal + delivery_fee;

    // Apply coupon discount server-side using a locked read so concurrent checkouts
    // cannot both exceed max_uses. validateAndLock increments uses_count inside the
    // transaction, making the whole operation atomic.
    let discountAmount = 0;
    let appliedCouponCode = null;
    if (req.body.coupon_code) {
      const cv = await CouponModel.validateAndLock(req.body.coupon_code, total, client);
      if (cv.valid) {
        discountAmount    = cv.discountAmount;
        appliedCouponCode = cv.coupon.code;
        total             = Math.max(0, total - discountAmount);
      }
    }

    const orderId = uuid();
    const orderNumber = `ORD-${Date.now()}`;

    await client.query(
      `INSERT INTO orders
         (id, customer_id, order_number, total_amount, shipping_address, shipping_city,
          shipping_region, delivery_fee, coupon_code, discount_amount, notes, status, payment_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending','unpaid')`,
      [orderId, req.user.id, orderNumber, total, shipping_address, shipping_city,
       shipping_region, delivery_fee, appliedCouponCode, discountAmount, notes]
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

    res.status(201).json({ orderId, orderNumber, total, discountAmount, couponCode: appliedCouponCode });
  } catch (error) {
    // Only ROLLBACK if we actually opened a transaction
    if (transactionStarted) {
      await client.query('ROLLBACK').catch(() => {});
    }
    logger.error('Error creating order', { err: error.message });
    res.status(500).json({ error: 'Failed to create order' });
  } finally {
    client.release();
  }
};

const getOrders = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const { rows } = await pool.query(
      `SELECT id, order_number, total_amount, status, payment_status, created_at
         FROM orders
        WHERE customer_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );

    const { rows: countRows } = await pool.query(
      'SELECT COUNT(*) FROM orders WHERE customer_id = $1',
      [req.user.id]
    );

    const total = parseInt(countRows[0].count);
    res.json({
      orders:  rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
};

const getOrderById = async (req, res) => {
  try {
    // Admins can see any order; customers only see their own
    const customerId = req.user.role === 'admin' ? null : req.user.id;
    const order = await OrderModel.findById(req.params.orderId, customerId);
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
    const { status, note } = req.body;
    const { rows } = await pool.query('SELECT status FROM orders WHERE id=$1', [req.params.orderId]);
    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });
    const fromStatus = rows[0].status;

    // Enforce state machine — throws 400 on invalid transition
    assertTransition(fromStatus, status);

    await OrderModel.updateStatus(req.params.orderId, status);
    await logStatusChange(req.params.orderId, fromStatus, status, note || 'Manual update by admin');
    logger.info('Order status updated', { orderId: req.params.orderId, from: fromStatus, to: status });
    res.json({ message: 'Order status updated' });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    logger.error('updateOrderStatus error', { err: error.message });
    res.status(500).json({ error: 'Failed to update order status' });
  }
};

const cancelOrder = async (req, res) => {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    const { reason } = req.body;
    const cancellationReason = reason || null;
    const cancellableStatuses = ['pending', 'confirmed', 'processing'];

    await client.query('BEGIN');
    transactionStarted = true;

    const { rows } = await client.query(
      `SELECT id, order_number, status, payment_status, refund_status, coupon_code,
              stock_restored, coupon_returned
         FROM orders
        WHERE id = $1
        FOR UPDATE`,
      [req.params.orderId]
    );

    const order = rows[0];
    if (!order) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.status === 'cancelled') {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(409).json({ error: 'Order is already cancelled' });
    }

    if (!cancellableStatuses.includes(order.status)) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(400).json({ error: `Cannot cancel order with status "${order.status}"` });
    }

    let stockRestored = order.stock_restored;
    if (!stockRestored) {
      const { rows: items } = await client.query(
        `SELECT product_id, quantity
           FROM order_items
          WHERE order_id = $1
          FOR UPDATE`,
        [order.id]
      );

      for (const item of items) {
        await InventoryModel.adjustStock(
          item.product_id,
          item.quantity,
          'order_cancelled',
          `Restored from cancelled order ${order.order_number || order.id}`,
          client
        );
      }

      stockRestored = true;
    }

    let couponReturned = order.coupon_returned;
    if (order.coupon_code && !couponReturned) {
      await client.query(
        `UPDATE coupons
            SET uses_count = GREATEST(0, uses_count - 1),
                updated_at = NOW()
          WHERE UPPER(code) = UPPER($1)`,
        [order.coupon_code]
      );

      couponReturned = true;
    }

    const { rows: updatedRows } = await client.query(
      `UPDATE orders
          SET status = 'cancelled',
              cancelled_at = NOW(),
              cancellation_reason = $1,
              cancelled_by = $2,
              stock_restored = $3,
              coupon_returned = $4,
              updated_at = NOW()
        WHERE id = $5
        RETURNING *`,
      [cancellationReason, req.user?.id || null, stockRestored, couponReturned, order.id]
    );

    await logStatusChange(
      order.id,
      order.status,
      'cancelled',
      cancellationReason || 'Order cancelled by admin',
      client
    );

    await client.query('COMMIT');
    transactionStarted = false;

    logger.info('Order cancelled', { orderId: order.id, from: order.status, to: 'cancelled' });
    res.json({ message: 'Order cancelled', order: updatedRows[0] });
  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK').catch(() => {});
    }
    logger.error('cancelOrder error', { err: error.message, orderId: req.params.orderId });
    res.status(500).json({ error: 'Failed to cancel order' });
  } finally {
    client.release();
  }
};

function getRefundEligibilityError(order) {
  if (order.refund_status === 'pending') {
    return { status: 409, message: 'Refund already pending' };
  }
  if (order.refund_status === 'success') {
    return { status: 409, message: 'Order already refunded' };
  }
  if (order.payment_status !== 'paid') {
    return { status: 400, message: 'Only paid orders can be refunded' };
  }
  if (!['cancelled', 'delivered'].includes(order.status)) {
    return { status: 400, message: `Cannot refund order with status "${order.status}"` };
  }
  return null;
}

async function findPaystackTransactionReference(client, order) {
  const { rows } = await client.query(
    `SELECT COALESCE(
              NULLIF($2, ''),
              (
                SELECT p.paystack_reference
                  FROM payments p
                 WHERE p.order_id = $1
                   AND p.payment_method = 'paystack'
                   AND p.status = 'success'
                 ORDER BY p.updated_at DESC, p.created_at DESC
                 LIMIT 1
              ),
              (
                SELECT p.paystack_reference
                  FROM payments p
                 WHERE p.order_id = $1
                   AND p.payment_method = 'paystack'
                 ORDER BY p.updated_at DESC, p.created_at DESC
                 LIMIT 1
              )
            ) AS reference`,
    [order.id, order.payment_reference || null]
  );

  return rows[0]?.reference || null;
}

const refundOrder = async (req, res) => {
  const { method, reference, notes } = req.body;

  if (method === 'manual') {
    const client = await pool.connect();
    let transactionStarted = false;

    try {
      await client.query('BEGIN');
      transactionStarted = true;

      const { rows } = await client.query(
        `SELECT id, status, payment_status, refund_status, total_amount
           FROM orders
          WHERE id = $1
          FOR UPDATE`,
        [req.params.orderId]
      );

      const order = rows[0];
      if (!order) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return res.status(404).json({ error: 'Order not found' });
      }

      const eligibilityError = getRefundEligibilityError(order);
      if (eligibilityError) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return res.status(eligibilityError.status).json({ error: eligibilityError.message });
      }

      const { rows: updatedRows } = await client.query(
        `UPDATE orders
            SET refund_status = 'success',
                refund_requested_at = NOW(),
                refunded_at = NOW(),
                refund_method = 'manual',
                refund_amount = total_amount,
                refund_reference = $1,
                refund_notes = $2,
                payment_status = 'refunded',
                status = 'refunded',
                updated_at = NOW()
          WHERE id = $3
          RETURNING *`,
        [reference, notes || null, order.id]
      );

      await logStatusChange(
        order.id,
        order.status,
        'refunded',
        notes || `Manual refund confirmed: ${reference}`,
        client
      );

      await client.query('COMMIT');
      transactionStarted = false;

      logger.info('Manual refund completed', { orderId: order.id, from: order.status, to: 'refunded' });
      return res.json({ message: 'Order refunded', order: updatedRows[0] });
    } catch (error) {
      if (transactionStarted) {
        await client.query('ROLLBACK').catch(() => {});
      }
      logger.error('manual refundOrder error', { err: error.message, orderId: req.params.orderId });
      return res.status(500).json({ error: 'Failed to refund order' });
    } finally {
      client.release();
    }
  }

  let reservedOrder = null;
  let transactionReference = null;

  const reserveClient = await pool.connect();
  let reserveTransactionStarted = false;
  try {
    await reserveClient.query('BEGIN');
    reserveTransactionStarted = true;

    const { rows } = await reserveClient.query(
      `SELECT id, status, payment_status, refund_status, total_amount, payment_reference
         FROM orders
        WHERE id = $1
        FOR UPDATE`,
      [req.params.orderId]
    );

    const order = rows[0];
    if (!order) {
      await reserveClient.query('ROLLBACK');
      reserveTransactionStarted = false;
      return res.status(404).json({ error: 'Order not found' });
    }

    const eligibilityError = getRefundEligibilityError(order);
    if (eligibilityError) {
      await reserveClient.query('ROLLBACK');
      reserveTransactionStarted = false;
      return res.status(eligibilityError.status).json({ error: eligibilityError.message });
    }

    transactionReference = await findPaystackTransactionReference(reserveClient, order);
    if (!transactionReference) {
      await reserveClient.query('ROLLBACK');
      reserveTransactionStarted = false;
      return res.status(400).json({ error: 'Cannot find original Paystack payment reference for this order' });
    }

    const { rows: reservedRows } = await reserveClient.query(
      `UPDATE orders
          SET refund_status = 'pending',
              refund_method = 'paystack',
              refund_amount = total_amount,
              refund_notes = $1,
              updated_at = NOW()
        WHERE id = $2
        RETURNING *`,
      [notes || null, order.id]
    );

    await reserveClient.query('COMMIT');
    reserveTransactionStarted = false;
    reservedOrder = reservedRows[0];
  } catch (error) {
    if (reserveTransactionStarted) {
      await reserveClient.query('ROLLBACK').catch(() => {});
    }
    logger.error('paystack refund reserve error', { err: error.message, orderId: req.params.orderId });
    return res.status(500).json({ error: 'Failed to request refund' });
  } finally {
    reserveClient.release();
  }

  let refundData;
  try {
    refundData = await createFullRefund({
      transactionReference,
      amount: reservedOrder.total_amount,
      notes,
    });
  } catch (error) {
    const failureDetail = error.response?.data?.message || error.response?.data?.error || error.message;
    const failClient = await pool.connect();
    let failTransactionStarted = false;

    try {
      await failClient.query('BEGIN');
      failTransactionStarted = true;

      const failedNotes = [notes, `Paystack refund request failed: ${failureDetail}`]
        .filter(Boolean)
        .join('\n');

      const { rows: failedRows } = await failClient.query(
        `UPDATE orders
            SET refund_status = 'failed',
                refund_method = 'paystack',
                refund_amount = total_amount,
                refund_notes = $1,
                updated_at = NOW()
          WHERE id = $2
            AND refund_status = 'pending'
          RETURNING *`,
        [failedNotes, reservedOrder.id]
      );

      await failClient.query('COMMIT');
      failTransactionStarted = false;

      logger.error('Paystack refund request failed', {
        orderId: reservedOrder.id,
        err: failureDetail,
      });

      const statusCode = error.response?.status >= 400 && error.response?.status < 500 ? 400 : 502;
      return res.status(statusCode).json({
        error: 'Paystack refund request failed',
        detail: failureDetail,
        order: failedRows[0] || null,
      });
    } catch (updateError) {
      if (failTransactionStarted) {
        await failClient.query('ROLLBACK').catch(() => {});
      }
      logger.error('Failed to mark Paystack refund failed', {
        err: updateError.message,
        orderId: reservedOrder.id,
      });
      return res.status(500).json({ error: 'Failed to update failed refund status' });
    } finally {
      failClient.release();
    }
  }

  const providerId = refundData.id || refundData.refund_id || null;
  const providerReference = refundData.reference || reference || null;
  const completeClient = await pool.connect();
  let completeTransactionStarted = false;

  try {
    await completeClient.query('BEGIN');
    completeTransactionStarted = true;

    const { rows: updatedRows } = await completeClient.query(
      `UPDATE orders
          SET refund_status = 'pending',
              refund_requested_at = NOW(),
              refund_method = 'paystack',
              refund_amount = total_amount,
              refund_provider_id = $1,
              refund_reference = $2,
              refund_notes = $3,
              refunded_at = NULL,
              updated_at = NOW()
        WHERE id = $4
          AND refund_status = 'pending'
        RETURNING *`,
      [providerId, providerReference, notes || null, reservedOrder.id]
    );

    await completeClient.query('COMMIT');
    completeTransactionStarted = false;

    logger.info('Paystack refund requested', {
      orderId: reservedOrder.id,
      refundProviderId: providerId,
      refundReference: providerReference,
    });

    return res.json({ message: 'Refund requested', order: updatedRows[0] || reservedOrder });
  } catch (error) {
    if (completeTransactionStarted) {
      await completeClient.query('ROLLBACK').catch(() => {});
    }
    logger.error('paystack refund finalize error', { err: error.message, orderId: reservedOrder.id });
    return res.status(500).json({ error: 'Failed to update refund request' });
  } finally {
    completeClient.release();
  }
};

// Return the full status audit trail for an order
const getOrderStatusLog = async (req, res) => {
  try {
    const { orderId } = req.params;
    // Admins can see any order; customers only their own
    if (req.user.role !== 'admin') {
      const order = await OrderModel.findById(orderId, req.user.id);
      if (!order) return res.status(404).json({ error: 'Order not found' });
    }
    const { rows } = await pool.query(
      `SELECT from_status, to_status, note, created_at
         FROM order_status_log
        WHERE order_id = $1
        ORDER BY created_at ASC`,
      [orderId]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch status log' });
  }
};

// Guest checkout — no user session required
const createGuestOrder = async (req, res) => {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    const {
      email, first_name, last_name, phone,
      shipping_address, shipping_city, shipping_region,
      notes, items,
    } = req.body;
    let { delivery_fee = 0 } = req.body;

    if (!email || !first_name || !phone || !shipping_address || !shipping_city || !shipping_region) {
      return res.status(400).json({ error: 'email, first_name, phone, and full shipping address are required' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    delivery_fee = parseFloat(delivery_fee);
    if (isNaN(delivery_fee) || delivery_fee < 0) delivery_fee = 0;

    await client.query('BEGIN');
    transactionStarted = true;

    // Fetch and lock products
    const productIds = items.map(i => i.product_id);
    const { rows: products } = await client.query(
      `SELECT id, price, stock_quantity FROM products WHERE id = ANY($1) FOR UPDATE`,
      [productIds]
    );
    const productMap = Object.fromEntries(products.map(p => [p.id, p]));

    for (const item of items) {
      const p = productMap[item.product_id];
      if (!p) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Product not found: ${item.product_id}` });
      }
      if (p.stock_quantity < item.quantity) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Insufficient stock for one or more items' });
      }
    }

    let subtotal = 0;
    items.forEach(item => { subtotal += parseFloat(productMap[item.product_id].price) * item.quantity; });
    let total = subtotal + delivery_fee;

    // Apply coupon discount server-side (locked — same as authenticated checkout)
    let discountAmount = 0;
    let appliedCouponCode = null;
    if (req.body.coupon_code) {
      const cv = await CouponModel.validateAndLock(req.body.coupon_code, total, client);
      if (cv.valid) {
        discountAmount    = cv.discountAmount;
        appliedCouponCode = cv.coupon.code;
        total             = Math.max(0, total - discountAmount);
      }
    }

    const orderId = uuid();
    const orderNumber = `ORD-${Date.now()}`;
    const guestNotes = `Phone: ${phone}${notes ? '\n' + notes : ''}`;
    const fullNotes = `Guest: ${first_name} ${last_name || ''} <${email}>\n${guestNotes}`;

    await client.query(
      `INSERT INTO orders
         (id, customer_id, order_number, total_amount, shipping_address, shipping_city,
          shipping_region, delivery_fee, coupon_code, discount_amount, notes, guest_email, status, payment_status)
       VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending','unpaid')`,
      [orderId, orderNumber, total, shipping_address, shipping_city,
       shipping_region, delivery_fee, appliedCouponCode, discountAmount, fullNotes, email]
    );

    for (const item of items) {
      const p = productMap[item.product_id];
      await client.query(
        'INSERT INTO order_items (id, order_id, product_id, quantity, price_at_purchase, subtotal) VALUES ($1,$2,$3,$4,$5,$6)',
        [uuid(), orderId, item.product_id, item.quantity, p.price, parseFloat(p.price) * item.quantity]
      );
      await InventoryModel.adjustStock(item.product_id, -item.quantity, 'sale', null, client);
    }

    await client.query('COMMIT');

    res.status(201).json({ orderId, orderNumber, total, discountAmount, couponCode: appliedCouponCode, email });
  } catch (error) {
    if (transactionStarted) await client.query('ROLLBACK').catch(() => {});
    logger.error('Error creating guest order', { err: error.message });
    res.status(500).json({ error: 'Failed to create order' });
  } finally {
    client.release();
  }
};

// Returns which products in this order the logged-in user has already reviewed.
// Only meaningful for delivered orders, but works for any status.
const getReviewStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await OrderModel.findById(orderId, req.user.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const items = await OrderModel.getItems(orderId);
    const reviewed = (
      await Promise.all(items.map(item => ReviewModel.findByUser(req.user.id, item.product_id)))
    )
      .map((r, i) => r ? items[i].product_id : null)
      .filter(Boolean);

    res.json({ reviewed });
  } catch (err) {
    res.status(500).json({ error: 'Failed to check review status' });
  }
};

module.exports = { createOrder, createGuestOrder, getOrders, getOrderById, getAllOrders, updateOrderStatus, cancelOrder, refundOrder, getOrderStatusLog, getReviewStatus };

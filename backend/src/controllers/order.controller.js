const { randomUUID: uuid } = require('crypto');
const pool = require('../config/database');
const OrderModel = require('../models/order.model');
const InventoryModel = require('../models/inventory.model');
const VariantModel = require('../models/variant.model');
const ReviewModel = require('../models/review.model');
const CouponModel = require('../models/coupon.model');
const { logStatusChange } = require('../utils/audit');
const { assertTransition } = require('../utils/stateMachine');
const { createFullRefund } = require('../services/paystack.service');
const logger = require('../utils/logger');

function parseSettingNumber(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

async function computeServerDeliveryFee(client, shippingRegion, subtotal) {
  const { rows } = await client.query(
    `SELECT key, value FROM site_settings
      WHERE key = ANY($1::text[])`,
    [['delivery_fee_flat', 'delivery_fee_accra', 'free_delivery_over']]
  );
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));

  const feeFlat  = parseSettingNumber(map.delivery_fee_flat, 15);
  const feeAccra = parseSettingNumber(map.delivery_fee_accra, 10);
  const freeOver = parseSettingNumber(map.free_delivery_over, 200);

  if (freeOver > 0 && subtotal >= freeOver) {
    return 0;
  }

  const normalized = String(shippingRegion || '').trim().toLowerCase();
  const isAccra = normalized === 'greater accra' || normalized === 'accra';
  return isAccra ? feeAccra : feeFlat;
}

const createOrder = async (req, res) => {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    const { shipping_address, shipping_city, shipping_region, notes } = req.body;

    if (!shipping_address || !shipping_city || !shipping_region) {
      return res.status(400).json({ error: 'Shipping address, city, and region are required' });
    }

    // BEGIN before the cart fetch so the entire operation is one atomic unit
    await client.query('BEGIN');
    transactionStarted = true;

    // Lock cart rows — include variant price/stock when variant_id is present
    const cartResult = await client.query(
      `SELECT ci.quantity, ci.variant_id, ci.variant_label,
              p.id AS product_id,
              COALESCE(pv.price,          p.price)          AS price,
              COALESCE(pv.stock_quantity, p.stock_quantity)  AS stock_quantity
         FROM cart_items ci
         JOIN products p ON ci.product_id = p.id
         LEFT JOIN product_variants pv ON ci.variant_id = pv.id
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

    // Authoritative server-side delivery fee — client-supplied delivery_fee is ignored.
    const delivery_fee = await computeServerDeliveryFee(client, shipping_region, subtotal);
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
        `INSERT INTO order_items
           (id, order_id, product_id, quantity, price_at_purchase, subtotal, variant_id, variant_label)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [uuid(), orderId, item.product_id, item.quantity, item.price,
         parseFloat(item.price) * item.quantity,
         item.variant_id || null, item.variant_label || null]
      );
      if (item.variant_id) {
        await VariantModel.adjustStock(item.variant_id, -item.quantity, client);
      } else {
        await InventoryModel.adjustStock(item.product_id, -item.quantity, 'sale', null, client);
      }
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
      `SELECT id, order_number, total_amount, status, payment_status, refund_status, created_at,
              cancel_requested, cancel_request_rejected,
              return_requested, return_request_rejected
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
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const { status, search } = req.query;

    const params = [];
    const clauses = [];

    if (status) {
      params.push(status);
      clauses.push(`o.status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      clauses.push(`(o.order_number ILIKE $${params.length} OR COALESCE(u.email, o.guest_email) ILIKE $${params.length})`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const countParams = [...params];
    params.push(limit, offset);

    const [dataResult, countResult] = await Promise.all([
      pool.query(`
        SELECT o.id, o.order_number, o.total_amount, o.status, o.payment_status,
               o.refund_status, o.created_at,
               o.cancel_requested, o.cancel_request_rejected,
               o.return_requested, o.return_request_rejected,
               COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.email, o.guest_email, 'Guest') AS customer_name,
               COALESCE(u.email, o.guest_email) AS customer_email
          FROM orders o
          LEFT JOIN users u ON o.customer_id = u.id
          ${where}
         ORDER BY o.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}
      `, params),
      pool.query(`
        SELECT COUNT(*) FROM orders o
        LEFT JOIN users u ON o.customer_id = u.id
        ${where}
      `, countParams),
    ]);

    const total = parseInt(countResult.rows[0].count);
    res.json({
      orders:     dataResult.rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
};

const getRequestCounts = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*) FILTER (
          WHERE cancel_requested = true AND cancel_request_rejected = false
            AND status NOT IN ('cancelled', 'refunded')
        ) AS cancel_count,
        COUNT(*) FILTER (
          WHERE return_requested = true AND return_request_rejected = false
            AND status NOT IN ('cancelled', 'refunded')
        ) AS return_count,
        COUNT(*) FILTER (WHERE status = 'pending') AS pending_orders
      FROM orders
    `);
    res.json({
      cancel:        parseInt(rows[0].cancel_count),
      return:        parseInt(rows[0].return_count),
      pendingOrders: parseInt(rows[0].pending_orders),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch request counts' });
  }
};

const getRequests = async (req, res) => {
  try {
    const { type } = req.query;
    if (type !== 'cancel' && type !== 'return') {
      return res.status(400).json({ error: 'type must be "cancel" or "return"' });
    }

    const where = type === 'cancel'
      ? `WHERE o.cancel_requested = true AND o.cancel_request_rejected = false AND o.status NOT IN ('cancelled', 'refunded')`
      : `WHERE o.return_requested = true AND o.return_request_rejected = false AND o.status NOT IN ('cancelled', 'refunded')`;

    const { rows } = await pool.query(`
      SELECT o.id, o.order_number, o.total_amount, o.status, o.payment_status,
             o.cancel_reason, o.cancel_requested_at,
             o.return_reason, o.return_requested_at,
             COALESCE(u.email, o.guest_email) AS customer_email,
             COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.email, o.guest_email, 'Guest') AS customer_name
        FROM orders o
        LEFT JOIN users u ON o.customer_id = u.id
        ${where}
       ORDER BY COALESCE(o.cancel_requested_at, o.return_requested_at) DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
};

const exportOrders = async (req, res) => {
  try {
    const { status, search, from, to } = req.query;
    const params = [];
    const clauses = [];

    if (status) {
      params.push(status);
      clauses.push(`o.status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      clauses.push(`(o.order_number ILIKE $${params.length} OR COALESCE(u.email, o.guest_email) ILIKE $${params.length})`);
    }
    if (from) {
      params.push(from);
      clauses.push(`o.created_at >= $${params.length}::date`);
    }
    if (to) {
      params.push(to);
      clauses.push(`o.created_at < ($${params.length}::date + INTERVAL '1 day')`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const { rows } = await pool.query(`
      SELECT o.order_number, o.total_amount, o.status, o.payment_status, o.created_at,
             COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.email, o.guest_email, 'Guest') AS customer_name,
             COALESCE(u.email, o.guest_email, '') AS customer_email
        FROM orders o
        LEFT JOIN users u ON o.customer_id = u.id
        ${where}
       ORDER BY o.created_at DESC
    `, params);

    const headers = ['Order Number', 'Customer Name', 'Customer Email', 'Total (GHS)', 'Status', 'Payment Status', 'Created At'];
    const csvRows = rows.map(r => [
      r.order_number,
      r.customer_name,
      r.customer_email,
      parseFloat(r.total_amount).toFixed(2),
      r.status,
      r.payment_status,
      new Date(r.created_at).toISOString(),
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

    const csv = [headers.join(','), ...csvRows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="orders-${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) {
    logger.error('exportOrders error', { err: err.message });
    res.status(500).json({ error: 'Failed to export orders' });
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
        `SELECT product_id, quantity, variant_id
           FROM order_items
          WHERE order_id = $1
          FOR UPDATE`,
        [order.id]
      );

      for (const item of items) {
        if (item.variant_id) {
          await VariantModel.adjustStock(item.variant_id, item.quantity, client);
        } else {
          await InventoryModel.adjustStock(
            item.product_id,
            item.quantity,
            'order_cancelled',
            `Restored from cancelled order ${order.order_number || order.id}`,
            client
          );
        }
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
              cancelled_by = (SELECT id FROM users WHERE id = $2 LIMIT 1),
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

    const { notificationQueue } = require('../queues');
    notificationQueue.add('order-cancelled', { orderId: order.id })
      .catch(err => logger.error('Failed to enqueue cancellation notification', { err: err.message, orderId: order.id }));

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

      const { notificationQueue } = require('../queues');
      notificationQueue.add('order-refunded', { orderId: order.id })
        .catch(err => logger.error('Failed to enqueue refund notification', { err: err.message, orderId: order.id }));

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

    if (!email || !first_name || !phone || !shipping_address || !shipping_city || !shipping_region) {
      return res.status(400).json({ error: 'email, first_name, phone, and full shipping address are required' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    await client.query('BEGIN');
    transactionStarted = true;

    // Fetch and lock products
    const productIds = [...new Set(items.map(i => i.product_id))];
    const { rows: products } = await client.query(
      `SELECT id, price, stock_quantity FROM products WHERE id = ANY($1) FOR UPDATE`,
      [productIds]
    );
    const productMap = Object.fromEntries(products.map(p => [p.id, p]));

    // Fetch and lock variants when present
    const variantIds = items.map(i => i.variant_id).filter(Boolean);
    let variantMap = {};
    if (variantIds.length > 0) {
      const { rows: variants } = await client.query(
        `SELECT id, price, stock_quantity, is_active FROM product_variants WHERE id = ANY($1) FOR UPDATE`,
        [variantIds]
      );
      variantMap = Object.fromEntries(variants.map(v => [v.id, v]));
    }

    for (const item of items) {
      const p = productMap[item.product_id];
      if (!p) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Product not found: ${item.product_id}` });
      }
      const effectiveStock = item.variant_id && variantMap[item.variant_id]
        ? variantMap[item.variant_id].stock_quantity
        : p.stock_quantity;
      if (effectiveStock < item.quantity) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Insufficient stock for one or more items' });
      }
    }

    let subtotal = 0;
    items.forEach(item => {
      const p = productMap[item.product_id];
      const effectivePrice = item.variant_id && variantMap[item.variant_id]
        ? variantMap[item.variant_id].price
        : p.price;
      subtotal += parseFloat(effectivePrice) * item.quantity;
    });

    // Authoritative server-side delivery fee — client-supplied delivery_fee is ignored.
    const delivery_fee = await computeServerDeliveryFee(client, shipping_region, subtotal);
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
      const effectivePrice = item.variant_id && variantMap[item.variant_id]
        ? variantMap[item.variant_id].price
        : p.price;
      await client.query(
        `INSERT INTO order_items
           (id, order_id, product_id, quantity, price_at_purchase, subtotal, variant_id, variant_label)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [uuid(), orderId, item.product_id, item.quantity,
         effectivePrice, parseFloat(effectivePrice) * item.quantity,
         item.variant_id || null, item.variant_label || null]
      );
      if (item.variant_id) {
        await VariantModel.adjustStock(item.variant_id, -item.quantity, client);
      } else {
        await InventoryModel.adjustStock(item.product_id, -item.quantity, 'sale', null, client);
      }
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

// ── Customer cancel request ───────────────────────────────────────────────────
const requestCancel = async (req, res) => {
  const { reason } = req.body;
  const { orderId } = req.params;

  try {
    const { rows } = await pool.query(
      `SELECT id, status, customer_id, cancel_requested, cancel_request_rejected
         FROM orders WHERE id = $1`,
      [orderId]
    );
    const order = rows[0];
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.customer_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    if (!['pending', 'confirmed'].includes(order.status)) {
      return res.status(400).json({ error: `Cannot request cancellation for order with status "${order.status}"` });
    }
    if (order.cancel_requested && !order.cancel_request_rejected) {
      return res.status(409).json({ error: 'Cancellation already requested' });
    }

    await pool.query(
      `UPDATE orders
          SET cancel_requested = true,
              cancel_reason = $1,
              cancel_requested_at = NOW(),
              cancel_request_rejected = false,
              updated_at = NOW()
        WHERE id = $2`,
      [reason, orderId]
    );

    const { notificationQueue } = require('../queues');
    notificationQueue.add('cancel-requested', { orderId })
      .catch(err => logger.error('Failed to enqueue cancel-requested notification', { err: err.message, orderId }));

    res.json({ message: 'Cancellation request submitted' });
  } catch (err) {
    logger.error('requestCancel error', { err: err.message, orderId });
    res.status(500).json({ error: 'Failed to submit cancellation request' });
  }
};

// ── Customer return request ────────────────────────────────────────────────────
const requestReturn = async (req, res) => {
  const { reason } = req.body;
  const { orderId } = req.params;

  try {
    const { rows } = await pool.query(
      `SELECT id, status, payment_status, customer_id, return_requested, return_request_rejected
         FROM orders WHERE id = $1`,
      [orderId]
    );
    const order = rows[0];
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.customer_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    if (order.status !== 'delivered') {
      return res.status(400).json({ error: 'Returns can only be requested for delivered orders' });
    }
    if (order.payment_status !== 'paid') {
      return res.status(400).json({ error: 'Only paid orders are eligible for return' });
    }
    if (order.return_requested && !order.return_request_rejected) {
      return res.status(409).json({ error: 'Return already requested' });
    }

    await pool.query(
      `UPDATE orders
          SET return_requested = true,
              return_reason = $1,
              return_requested_at = NOW(),
              return_request_rejected = false,
              updated_at = NOW()
        WHERE id = $2`,
      [reason, orderId]
    );

    const { notificationQueue } = require('../queues');
    notificationQueue.add('return-requested', { orderId })
      .catch(err => logger.error('Failed to enqueue return-requested notification', { err: err.message, orderId }));

    res.json({ message: 'Return request submitted' });
  } catch (err) {
    logger.error('requestReturn error', { err: err.message, orderId });
    res.status(500).json({ error: 'Failed to submit return request' });
  }
};

// ── Admin: approve cancel request ─────────────────────────────────────────────
// Delegates to the existing cancelOrder logic by calling it as if it were a direct
// cancel, passing the customer's reason through and resetting the request flag.
const approveCancelRequest = async (req, res) => {
  const { orderId } = req.params;

  try {
    const { rows } = await pool.query(
      `SELECT id, cancel_requested, cancel_reason, status FROM orders WHERE id = $1`,
      [orderId]
    );
    const order = rows[0];
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!order.cancel_requested) return res.status(400).json({ error: 'No cancellation request pending' });

    // Delegate to cancelOrder — fake req to reuse the full transactional logic
    req.body = { reason: order.cancel_reason || 'Approved customer cancellation request' };
    return cancelOrder(req, res);
  } catch (err) {
    logger.error('approveCancelRequest error', { err: err.message, orderId });
    res.status(500).json({ error: 'Failed to approve cancellation request' });
  }
};

// ── Admin: reject cancel request ──────────────────────────────────────────────
const rejectCancelRequest = async (req, res) => {
  const { orderId } = req.params;

  try {
    const result = await pool.query(
      `UPDATE orders
          SET cancel_request_rejected = true,
              updated_at = NOW()
        WHERE id = $1 AND cancel_requested = true
        RETURNING id`,
      [orderId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Order not found or no cancel request pending' });
    }

    const { notificationQueue } = require('../queues');
    notificationQueue.add('cancel-rejected', { orderId })
      .catch(err => logger.error('Failed to enqueue cancel-rejected notification', { err: err.message, orderId }));

    res.json({ message: 'Cancellation request rejected' });
  } catch (err) {
    logger.error('rejectCancelRequest error', { err: err.message, orderId });
    res.status(500).json({ error: 'Failed to reject cancellation request' });
  }
};

// ── Admin: approve return request ─────────────────────────────────────────────
// Delegates to the existing refundOrder logic.
const approveReturnRequest = async (req, res) => {
  const { orderId } = req.params;

  try {
    const { rows } = await pool.query(
      `SELECT o.id, o.return_requested, o.return_reason,
              (SELECT p.paystack_reference
                 FROM payments p
                WHERE p.order_id = o.id
                  AND p.payment_method = 'paystack'
                  AND p.status = 'success'
                ORDER BY p.updated_at DESC
                LIMIT 1) AS paystack_ref
         FROM orders o WHERE o.id = $1`,
      [orderId]
    );
    const order = rows[0];
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!order.return_requested) return res.status(400).json({ error: 'No return request pending' });

    // Use Paystack refund if the order was paid via Paystack so money is
    // actually returned. Fall back to manual for cash/external payments.
    req.body = order.paystack_ref
      ? { method: 'paystack', notes: order.return_reason || 'Approved customer return request' }
      : { method: 'manual', reference: `RETURN-APPROVED-${orderId.slice(0, 8).toUpperCase()}`, notes: order.return_reason || 'Approved customer return request' };

    return refundOrder(req, res);
  } catch (err) {
    logger.error('approveReturnRequest error', { err: err.message, orderId });
    res.status(500).json({ error: 'Failed to approve return request' });
  }
};

// ── Admin: reject return request ──────────────────────────────────────────────
const rejectReturnRequest = async (req, res) => {
  const { orderId } = req.params;

  try {
    const result = await pool.query(
      `UPDATE orders
          SET return_request_rejected = true,
              updated_at = NOW()
        WHERE id = $1 AND return_requested = true
        RETURNING id`,
      [orderId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Order not found or no return request pending' });
    }

    const { notificationQueue } = require('../queues');
    notificationQueue.add('return-rejected', { orderId })
      .catch(err => logger.error('Failed to enqueue return-rejected notification', { err: err.message, orderId }));

    res.json({ message: 'Return request rejected' });
  } catch (err) {
    logger.error('rejectReturnRequest error', { err: err.message, orderId });
    res.status(500).json({ error: 'Failed to reject return request' });
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

// POST /api/orders/track  (public — no auth)
const trackOrder = async (req, res) => {
  const { order_number, email } = req.body;
  if (!order_number || !email) {
    return res.status(400).json({ message: 'Order number and email are required' });
  }

  try {
    const { rows: orderRows } = await pool.query(
      `SELECT o.id, o.order_number, o.status, o.payment_status,
              o.created_at, o.updated_at,
              o.shipping_city, o.shipping_region
       FROM orders o
       LEFT JOIN users u ON o.customer_id = u.id
       WHERE o.order_number = $1
         AND (LOWER(u.email) = LOWER($2) OR LOWER(o.guest_email) = LOWER($2))
       LIMIT 1`,
      [order_number, email]
    );

    if (!orderRows.length) {
      return res.status(404).json({
        message: 'Order not found. Please check your order number and email address.',
      });
    }

    const order = orderRows[0];

    const [itemsResult, deliveryResult, logResult] = await Promise.all([
      pool.query(
        `SELECT p.name, oi.variant_label, oi.quantity,
                oi.price_at_purchase AS price, p.image_url
         FROM order_items oi
         JOIN products p ON oi.product_id = p.id
         WHERE oi.order_id = $1`,
        [order.id]
      ),
      pool.query(
        `SELECT status, delivery_partner, tracking_number, estimated_delivery
         FROM deliveries
         WHERE order_id = $1
         ORDER BY created_at DESC LIMIT 1`,
        [order.id]
      ),
      pool.query(
        `SELECT to_status AS status, created_at, note
         FROM order_status_log
         WHERE order_id = $1
         ORDER BY created_at ASC`,
        [order.id]
      ),
    ]);

    res.json({
      order_number:    order.order_number,
      status:          order.status,
      payment_status:  order.payment_status,
      created_at:      order.created_at,
      updated_at:      order.updated_at,
      items:           itemsResult.rows,
      delivery:        deliveryResult.rows[0] || null,
      status_history:  logResult.rows,
      shipping_address: {
        city:   order.shipping_city,
        region: order.shipping_region,
      },
    });
  } catch (err) {
    console.error('[trackOrder] error:', err);
    res.status(500).json({ message: 'Failed to track order' });
  }
};

module.exports = {
  createOrder, createGuestOrder, getOrders, getOrderById, getAllOrders,
  getRequestCounts, getRequests, exportOrders,
  updateOrderStatus, cancelOrder, refundOrder, getOrderStatusLog, getReviewStatus,
  requestCancel, requestReturn,
  approveCancelRequest, rejectCancelRequest,
  approveReturnRequest, rejectReturnRequest,
  trackOrder,
};

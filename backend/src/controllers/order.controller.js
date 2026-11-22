const { randomUUID: uuid } = require('crypto');
const pool = require('../config/database');
const OrderModel = require('../models/order.model');
const InventoryModel = require('../models/inventory.model');
const VariantModel = require('../models/variant.model');
const ReviewModel = require('../models/review.model');
const CouponModel = require('../models/coupon.model');
const { logStatusChange } = require('../utils/audit');
const { assertTransition } = require('../utils/stateMachine');
const { createFullRefund, fetchRefundsByTransaction } = require('../services/paystack.service');
const { insertOrderWithUniqueNumber } = require('../utils/orderNumber');
const logger = require('../utils/logger');

function parseSettingNumber(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function parseSettingBool(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
  }
  return fallback;
}

function isAccraRegion(region) {
  const normalized = String(region || '').trim().toLowerCase();
  return normalized === 'greater accra' || normalized === 'accra';
}

async function getCheckoutSettings(client) {
  const { rows } = await client.query(
    `SELECT key, value FROM site_settings
      WHERE key = ANY($1::text[])`,
    [[
      'delivery_fee_flat',
      'delivery_fee_accra',
      'free_delivery_over',
      'pickup_enabled',
      'pickup_location',
      'pay_on_delivery_enabled',
      'pay_on_delivery_accra_only',
      'guest_checkout_enabled',
    ]]
  );
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return {
    feeFlat:        parseSettingNumber(map.delivery_fee_flat, 15),
    feeAccra:       parseSettingNumber(map.delivery_fee_accra, 10),
    freeOver:       parseSettingNumber(map.free_delivery_over, 200),
    pickupEnabled:  parseSettingBool(map.pickup_enabled, true),
    pickupLocation: typeof map.pickup_location === 'string' && map.pickup_location.trim()
      ? map.pickup_location.trim()
      : 'East Legon, Accra (Call upon arrival)',
    podEnabled:           parseSettingBool(map.pay_on_delivery_enabled, false),
    podAccraOnly:         parseSettingBool(map.pay_on_delivery_accra_only, true),
    guestCheckoutEnabled: parseSettingBool(map.guest_checkout_enabled, false),
  };
}

function computeDeliveryFeeFromSettings(cfg, fulfillmentMethod, shippingRegion, subtotal) {
  if (fulfillmentMethod === 'pickup') return 0;
  if (cfg.freeOver > 0 && subtotal >= cfg.freeOver) return 0;
  return isAccraRegion(shippingRegion) ? cfg.feeAccra : cfg.feeFlat;
}

function validateFulfillmentAndPayment(cfg, fulfillmentMethod, paymentMethod, shippingRegion) {
  if (fulfillmentMethod === 'pickup' && !cfg.pickupEnabled) {
    return 'Store pickup is currently unavailable';
  }
  if (paymentMethod === 'pay_on_delivery') {
    if (!cfg.podEnabled) {
      return 'Pay on Delivery is currently unavailable';
    }
    if (cfg.podAccraOnly && fulfillmentMethod === 'delivery' && !isAccraRegion(shippingRegion)) {
      return 'Pay on Delivery is only available for Greater Accra deliveries or store pickup';
    }
  }
  return null;
}

const createOrder = async (req, res) => {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    const fulfillment_method = req.body.fulfillment_method === 'pickup' ? 'pickup' : 'delivery';
    const payment_method = req.body.payment_method === 'pay_on_delivery' ? 'pay_on_delivery' : 'paystack';
    const { notes, ghana_post_gps, delivery_landmark } = req.body;
    let { shipping_address, shipping_city, shipping_region } = req.body;

    if (fulfillment_method === 'delivery' && (!shipping_address || !shipping_city || !shipping_region)) {
      return res.status(400).json({ error: 'Shipping address, city, and region are required' });
    }

    // BEGIN before the cart fetch so the entire operation is one atomic unit
    await client.query('BEGIN');
    transactionStarted = true;

    const checkoutCfg = await getCheckoutSettings(client);
    const optionError = validateFulfillmentAndPayment(
      checkoutCfg, fulfillment_method, payment_method, shipping_region
    );
    if (optionError) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(400).json({ error: optionError });
    }

    if (fulfillment_method === 'pickup') {
      shipping_address = shipping_address?.trim() || `Pickup: ${checkoutCfg.pickupLocation}`;
      shipping_city    = shipping_city?.trim()    || 'Accra';
      shipping_region  = shipping_region?.trim()  || 'Greater Accra';
    }

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
        FOR UPDATE OF ci, p`,
      [req.user.id]
    );

    if (cartResult.rows.length === 0) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(400).json({ error: 'Cart is empty' });
    }

    // Validate stock for every item before writing anything
    for (const item of cartResult.rows) {
      if (item.stock_quantity < item.quantity) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return res.status(400).json({ error: 'Insufficient stock for one or more items' });
      }
    }

    let subtotal = 0;
    cartResult.rows.forEach(item => { subtotal += parseFloat(item.price) * item.quantity; });

    // Authoritative server-side delivery fee — client-supplied delivery_fee is ignored.
    const delivery_fee = computeDeliveryFeeFromSettings(
      checkoutCfg, fulfillment_method, shipping_region, subtotal
    );
    let total = subtotal + delivery_fee;

    // Apply coupon discount server-side using a locked read so concurrent checkouts
    // cannot both exceed max_uses. validateAndLock increments uses_count inside the
    // transaction, making the whole operation atomic.
    let discountAmount = 0;
    let appliedCouponCode = null;
    if (req.body.coupon_code) {
      const cv = await CouponModel.validateAndLock(req.body.coupon_code, total, client, {
        customerId: req.user.id,
        email: req.user.email || null,
      });
      if (cv.valid) {
        discountAmount    = cv.discountAmount;
        appliedCouponCode = cv.coupon.code;
        total             = Math.max(0, total - discountAmount);
      } else {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return res.status(400).json({ error: cv.error || 'Invalid or expired coupon' });
      }
    }

    if (payment_method !== 'pay_on_delivery' && (!Number.isFinite(total) || Math.round(total * 100) <= 0)) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(400).json({
        error: 'Order total must be greater than zero for online payment. Please adjust your cart or coupon.',
      });
    }

    const orderId = uuid();
    const initialStatus = payment_method === 'pay_on_delivery' ? 'confirmed' : 'pending';

    const orderNumber = await insertOrderWithUniqueNumber(client, async (candidate) => {
      await client.query(
        `INSERT INTO orders
           (id, customer_id, order_number, total_amount, shipping_address, shipping_city,
            shipping_region, delivery_fee, ghana_post_gps, delivery_landmark,
            coupon_code, discount_amount, notes,
            fulfillment_method, payment_method, status, payment_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'unpaid')`,
        [orderId, req.user.id, candidate, total, shipping_address, shipping_city,
         shipping_region, delivery_fee,
         ghana_post_gps ? String(ghana_post_gps).trim().toUpperCase() : null,
         delivery_landmark ? String(delivery_landmark).trim() : null,
         appliedCouponCode, discountAmount, notes,
         fulfillment_method, payment_method, initialStatus]
      );
    });

    if (payment_method === 'pay_on_delivery') {
      await logStatusChange(
        orderId,
        'pending',
        'confirmed',
        fulfillment_method === 'pickup'
          ? 'Order confirmed (Pay on Pickup)'
          : 'Order confirmed (Pay on Delivery)',
        client
      );
    }

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
    transactionStarted = false;

    pool.query(
      `UPDATE checkout_sessions
          SET recovered_order_id = $1, updated_at = NOW()
        WHERE recovered_order_id IS NULL
          AND customer_id = $2`,
      [orderId, req.user.id]
    ).catch(() => {});

    if (payment_method === 'pay_on_delivery') {
      const { notificationQueue, shipmentQueue } = require('../queues');
      notificationQueue.add('payment-success', { orderId, reference: `POD-${orderNumber}` })
        .catch(err => logger.error('Failed to enqueue POD confirmation notification', { err: err.message, orderId }));
      if (fulfillment_method === 'delivery') {
        shipmentQueue.add('create-shipment', { orderId })
          .catch(err => logger.error('Failed to enqueue POD shipment creation', { err: err.message, orderId }));
      }
    }

    res.status(201).json({
      orderId,
      orderNumber,
      total,
      deliveryFee: delivery_fee,
      discountAmount,
      couponCode: appliedCouponCode,
      fulfillment_method,
      payment_method,
      status: initialStatus,
    });
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
      `SELECT id, order_number, total_amount, status, payment_status, refund_status,
              fulfillment_method, payment_method, created_at,
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
    const isAdmin = req.user.role === 'admin';
    const customerId = isAdmin ? null : req.user.id;
    const order = await OrderModel.findById(req.params.orderId, customerId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const items = await OrderModel.getItems(req.params.orderId);
    if (isAdmin) {
      const { rows: payments } = await pool.query(
        `SELECT id, amount, currency, status, payment_method, paystack_reference, created_at, updated_at
           FROM payments
          WHERE order_id = $1
          ORDER BY created_at DESC`,
        [req.params.orderId]
      );
      return res.json({ order, items, payments });
    }
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
    const { status, search, fulfillment_method, payment_status } = req.query;

    const params = [];
    const clauses = [];

    if (status) {
      params.push(status);
      clauses.push(`o.status = $${params.length}`);
    }
    if (fulfillment_method) {
      params.push(fulfillment_method);
      clauses.push(`o.fulfillment_method = $${params.length}`);
    }
    if (payment_status) {
      params.push(payment_status);
      clauses.push(`o.payment_status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      clauses.push(`(
        o.order_number ILIKE $${params.length}
        OR COALESCE(u.email, o.guest_email) ILIKE $${params.length}
        OR COALESCE(u.phone, o.guest_phone) ILIKE $${params.length}
        OR o.guest_first_name ILIKE $${params.length}
        OR o.guest_last_name ILIKE $${params.length}
        OR u.first_name ILIKE $${params.length}
        OR u.last_name ILIKE $${params.length}
      )`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const countParams = [...params];
    params.push(limit, offset);

    const [dataResult, countResult] = await Promise.all([
      pool.query(`
        SELECT o.id, o.order_number, o.total_amount, o.status, o.payment_status,
               o.refund_status, o.fulfillment_method, o.payment_method, o.created_at,
               o.cancel_requested, o.cancel_request_rejected,
               o.return_requested, o.return_request_rejected,
               o.customer_id,
               COALESCE(u.first_name || ' ' || u.last_name, u.first_name, NULLIF(TRIM(COALESCE(o.guest_first_name, '') || ' ' || COALESCE(o.guest_last_name, '')), ''), o.guest_email, 'Guest') AS customer_name,
               COALESCE(u.email, o.guest_email) AS customer_email,
               COALESCE(u.phone, o.guest_phone) AS customer_phone,
               (o.customer_id IS NULL) AS is_guest,
               (SELECT COUNT(*)::int FROM order_items WHERE order_id = o.id) AS item_count
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
            AND COALESCE(refund_status, 'not_requested') NOT IN ('pending', 'success')
        ) AS cancel_count,
        COUNT(*) FILTER (
          WHERE return_requested = true AND return_request_rejected = false
            AND status NOT IN ('cancelled', 'refunded')
            AND COALESCE(refund_status, 'not_requested') NOT IN ('pending', 'success')
        ) AS return_count,
        COUNT(*) FILTER (WHERE status = 'pending') AS pending_orders,
        (SELECT COUNT(*) FROM return_requests WHERE status = 'pending') AS partial_return_count
      FROM orders
    `);
    const legacyReturns = parseInt(rows[0].return_count, 10) || 0;
    const partialReturns = parseInt(rows[0].partial_return_count, 10) || 0;
    res.json({
      cancel:         parseInt(rows[0].cancel_count, 10) || 0,
      return:         legacyReturns + partialReturns,
      partialReturns,
      pendingOrders:  parseInt(rows[0].pending_orders, 10) || 0,
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
      ? `WHERE o.cancel_requested = true AND o.cancel_request_rejected = false AND o.status NOT IN ('cancelled', 'refunded') AND COALESCE(o.refund_status, 'not_requested') NOT IN ('pending', 'success')`
      : `WHERE o.return_requested = true AND o.return_request_rejected = false AND o.status NOT IN ('cancelled', 'refunded') AND COALESCE(o.refund_status, 'not_requested') NOT IN ('pending', 'success')`;

    const { rows } = await pool.query(`
      SELECT o.id, o.order_number, o.total_amount, o.status, o.payment_status, o.refund_status,
             o.fulfillment_method, o.payment_method, o.customer_id,
             o.cancel_reason, o.cancel_requested_at,
             o.return_reason, o.return_requested_at,
             COALESCE(u.email, o.guest_email) AS customer_email,
             COALESCE(u.phone, o.guest_phone) AS customer_phone,
             (o.customer_id IS NULL) AS is_guest,
             COALESCE(u.first_name || ' ' || u.last_name, u.first_name, NULLIF(TRIM(COALESCE(o.guest_first_name, '') || ' ' || COALESCE(o.guest_last_name, '')), ''), o.guest_email, 'Guest') AS customer_name,
             (SELECT COUNT(*)::int FROM order_items WHERE order_id = o.id) AS item_count,
             (
               SELECT json_agg(json_build_object(
                 'name', p.name,
                 'quantity', oi.quantity,
                 'variant_label', oi.variant_label,
                 'image_url', p.image_url
               ))
               FROM order_items oi
               JOIN products p ON oi.product_id = p.id
               WHERE oi.order_id = o.id
             ) AS items
        FROM orders o
        LEFT JOIN users u ON o.customer_id = u.id
        ${where}
       ORDER BY COALESCE(o.cancel_requested_at, o.return_requested_at) DESC
    `);

    if (type === 'return') {
      const { rows: partialRows } = await pool.query(`
        SELECT o.id, o.order_number, rr.refund_amount AS total_amount, o.status, o.payment_status, o.refund_status,
               o.fulfillment_method, o.payment_method, o.customer_id,
               rr.id AS return_id, TRUE AS is_partial_return, rr.status AS partial_return_status,
               rr.reason AS return_reason, rr.created_at AS return_requested_at,
               COALESCE(u.email, o.guest_email) AS customer_email,
               COALESCE(u.phone, o.guest_phone) AS customer_phone,
               (o.customer_id IS NULL) AS is_guest,
               COALESCE(u.first_name || ' ' || u.last_name, u.first_name, o.guest_email, 'Customer') AS customer_name,
               (SELECT COALESCE(SUM(quantity), 0)::int FROM return_request_items WHERE return_request_id = rr.id) AS item_count,
               (
                 SELECT json_agg(json_build_object(
                   'name', p.name,
                   'quantity', rri.quantity,
                   'variant_label', oi.variant_label,
                   'image_url', p.image_url
                 ))
                 FROM return_request_items rri
                 JOIN order_items oi ON oi.id = rri.order_item_id
                 JOIN products p ON p.id = oi.product_id
                 WHERE rri.return_request_id = rr.id
               ) AS items
          FROM return_requests rr
          JOIN orders o ON o.id = rr.order_id
          LEFT JOIN users u ON o.customer_id = u.id
         WHERE rr.status = 'pending'
         ORDER BY rr.created_at DESC
      `);
      return res.json([...partialRows, ...rows]);
    }

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
};

const exportOrders = async (req, res) => {
  try {
    const { status, search, from, to, fulfillment_method, payment_status } = req.query;
    const params = [];
    const clauses = [];

    if (status) {
      params.push(status);
      clauses.push(`o.status = $${params.length}`);
    }
    if (fulfillment_method) {
      params.push(fulfillment_method);
      clauses.push(`o.fulfillment_method = $${params.length}`);
    }
    if (payment_status) {
      params.push(payment_status);
      clauses.push(`o.payment_status = $${params.length}`);
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
      SELECT o.order_number, o.total_amount, o.status, o.payment_status, o.fulfillment_method, o.created_at,
             COALESCE(u.first_name || ' ' || u.last_name, u.first_name, NULLIF(TRIM(COALESCE(o.guest_first_name, '') || ' ' || COALESCE(o.guest_last_name, '')), ''), o.guest_email, 'Guest') AS customer_name,
             COALESCE(u.email, o.guest_email, '') AS customer_email,
             COALESCE(u.phone, o.guest_phone, '') AS customer_phone,
             (o.customer_id IS NULL) AS is_guest
        FROM orders o
        LEFT JOIN users u ON o.customer_id = u.id
        ${where}
       ORDER BY o.created_at DESC
    `, params);

    const headers = ['Order Number', 'Customer Name', 'Customer Email', 'Total (GHS)', 'Status', 'Payment Status', 'Fulfillment Method', 'Created At'];
    const csvRows = rows.map(r => [
      r.order_number,
      r.customer_name,
      r.customer_email,
      parseFloat(r.total_amount).toFixed(2),
      r.status,
      r.payment_status,
      r.fulfillment_method || 'delivery',
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

    // Notify the buyer by email on key fulfilment transitions (confirmed, processing/packing, shipped/ready-for-pickup, delivered/picked-up)
    if (['confirmed', 'processing', 'shipped', 'delivered'].includes(status)) {
      (async () => {
        try {
          const orderData = await OrderModel.findById(req.params.orderId);
          const customerEmail = orderData?.email || orderData?.guest_email;
          if (!customerEmail) return;

          const emailService = require('../services/email.service');
          let pickupLocation = null;
          let pickupHours = null;
          if (orderData.fulfillment_method === 'pickup') {
            const { rows: sRows } = await pool.query(
              `SELECT key, value FROM site_settings WHERE key IN ('pickup_location', 'pickup_hours')`
            );
            for (const r of sRows) {
              if (r.key === 'pickup_location') pickupLocation = r.value;
              if (r.key === 'pickup_hours') pickupHours = r.value;
            }
          }

          await emailService.sendOrderStatusUpdate(customerEmail, {
            customerName:      orderData.first_name || 'Valued Customer',
            orderNumber:       orderData.order_number,
            status,
            fulfillmentMethod: orderData.fulfillment_method,
            pickupLocation,
            pickupHours,
            note,
          });
          logger.info('Order status update email dispatched', { orderId: req.params.orderId, status, email: customerEmail });

          if (status === 'delivered') {
            const orderItems = await OrderModel.getItems(req.params.orderId);
            if (orderItems.length > 0) {
              await emailService.sendReviewRequest(customerEmail, {
                customerName: orderData.first_name || 'Valued Customer',
                orderNumber:  orderData.order_number,
                orderId:      orderData.id,
                items:        orderItems,
                frontendUrl:  process.env.FRONTEND_URL || 'http://localhost:5173',
              });
              logger.info('Review request email dispatched for delivered order', { orderId: req.params.orderId, email: customerEmail });
            }
          }
        } catch (mailErr) {
          logger.error('Failed to dispatch order status email', { err: mailErr.message, orderId: req.params.orderId, status });
        }
      })();
    }

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

    const { rows: activeReturns } = await client.query(
      `SELECT 1 FROM return_requests WHERE order_id = $1 AND status IN ('pending', 'refund_pending') LIMIT 1`,
      [order.id]
    );
    if (activeReturns.length > 0) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(409).json({ error: 'Cannot cancel order while a return request is pending or refunding' });
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
  if (order.refund_status === 'needs_attention') {
    return { status: 409, message: 'Refund already active and awaiting customer account details' };
  }
  if (order.refund_status === 'success') {
    return { status: 409, message: 'Order already refunded' };
  }
  if (!['paid', 'payment_review', 'partially_refunded'].includes(order.payment_status)) {
    return { status: 400, message: 'Only paid or payment_review orders can be refunded' };
  }
  if (!['cancelled', 'delivered'].includes(order.status)) {
    return { status: 400, message: `Cannot refund order with status "${order.status}"` };
  }
  return null;
}

async function findPaystackTransaction(client, order) {
  const { rows } = await client.query(
    `SELECT p.paystack_reference AS reference, p.amount
       FROM payments p
      WHERE p.order_id = $1
        AND p.payment_method = 'paystack'
      ORDER BY
        CASE
          WHEN p.status = 'success' THEN 1
          WHEN p.status = 'needs_review' THEN 2
          ELSE 3
        END,
        p.updated_at DESC,
        p.created_at DESC
      LIMIT 1`,
    [order.id]
  );

  if (rows[0]?.reference) {
    return {
      reference: rows[0].reference,
      amount: rows[0].amount != null ? parseFloat(rows[0].amount) : null,
    };
  }
  if (order.payment_reference) {
    return {
      reference: order.payment_reference,
      amount: order.total_amount != null ? parseFloat(order.total_amount) : null,
    };
  }
  return null;
}

const refundOrder = async (req, res) => {
  const { method, reference, notes } = req.body;
  const adminId = req.user?.id || 'unknown';

  if (method === 'manual') {
    const client = await pool.connect();
    let transactionStarted = false;

    try {
      await client.query('BEGIN');
      transactionStarted = true;

      const { rows } = await client.query(
        `SELECT id, status, payment_status, refund_status, total_amount, refund_amount, payment_reference
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

      const { rows: activeReturns } = await client.query(
        `SELECT 1 FROM return_requests WHERE order_id = $1 AND status IN ('pending', 'refund_pending') LIMIT 1`,
        [order.id]
      );
      if (activeReturns.length > 0) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return res.status(409).json({ error: 'Cannot issue full refund while an item return request is pending or refunding' });
      }

      const eligibilityError = getRefundEligibilityError(order);
      if (eligibilityError) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return res.status(eligibilityError.status).json({ error: eligibilityError.message });
      }

      const matchedTx = await findPaystackTransaction(client, order);
      const orderTotal = parseFloat(order.total_amount);
      const paidAmount = matchedTx?.amount != null && Number.isFinite(matchedTx.amount) && matchedTx.amount > 0 ? matchedTx.amount : orderTotal;
      const alreadyRefunded = Math.max(0, parseFloat(order.refund_amount || 0));
      const remainingRefund = Math.round((paidAmount - alreadyRefunded) * 100) / 100;
      if (remainingRefund <= 0) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return res.status(400).json({ error: 'Order has already been fully refunded' });
      }
      const refundAmount = Math.round(paidAmount * 100) / 100;

      const { rows: updatedRows } = await client.query(
        `UPDATE orders
            SET refund_status = 'success',
                refund_requested_at = NOW(),
                refunded_at = NOW(),
                refund_method = 'manual',
                refund_amount = $1,
                refund_reference = $2,
                refund_notes = $3,
                payment_status = 'refunded',
                status = 'refunded',
                updated_at = NOW()
          WHERE id = $4
          RETURNING *`,
        [refundAmount, reference, notes || null, order.id]
      );

      await client.query(
        `UPDATE payments
            SET status = 'refunded',
                updated_at = NOW()
          WHERE order_id = $1
            AND status IN ('success', 'needs_review')`,
        [order.id]
      );

      const auditNote = `Manual refund confirmed by admin ${adminId} (ref: ${reference})${notes ? ` — ${notes}` : ''}`;
      await logStatusChange(
        order.id,
        order.status,
        'refunded',
        auditNote,
        client
      );

      await client.query('COMMIT');
      transactionStarted = false;

      const { notificationQueue } = require('../queues');
      notificationQueue.add('order-refunded', { orderId: order.id })
        .catch(err => logger.error('Failed to enqueue refund notification', { err: err.message, orderId: order.id }));

      logger.info('Manual refund completed', {
        orderId: order.id,
        adminId,
        reference,
        refundAmount,
        from: order.status,
        to: 'refunded',
      });
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
  let refundAmount = null;

  const reserveClient = await pool.connect();
  let reserveTransactionStarted = false;
  try {
    await reserveClient.query('BEGIN');
    reserveTransactionStarted = true;

    const { rows } = await reserveClient.query(
      `SELECT id, status, payment_status, refund_status, total_amount, refund_amount, payment_reference
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

    const { rows: activeReturns } = await reserveClient.query(
      `SELECT 1 FROM return_requests WHERE order_id = $1 AND status IN ('pending', 'refund_pending') LIMIT 1`,
      [order.id]
    );
    if (activeReturns.length > 0) {
      await reserveClient.query('ROLLBACK');
      reserveTransactionStarted = false;
      return res.status(409).json({ error: 'Cannot issue full refund while an item return request is pending or refunding' });
    }

    const eligibilityError = getRefundEligibilityError(order);
    if (eligibilityError) {
      await reserveClient.query('ROLLBACK');
      reserveTransactionStarted = false;
      return res.status(eligibilityError.status).json({ error: eligibilityError.message });
    }

    const matchedTx = await findPaystackTransaction(reserveClient, order);
    transactionReference = matchedTx?.reference || null;
    if (!transactionReference) {
      await reserveClient.query('ROLLBACK');
      reserveTransactionStarted = false;
      return res.status(400).json({ error: 'Cannot find original Paystack payment reference for this order' });
    }

    const orderTotal = parseFloat(order.total_amount);
    const paidAmount = matchedTx?.amount != null && Number.isFinite(matchedTx.amount) && matchedTx.amount > 0 ? matchedTx.amount : orderTotal;
    const alreadyRefunded = Math.max(0, parseFloat(order.refund_amount || 0));
    refundAmount = Math.round((paidAmount - alreadyRefunded) * 100) / 100;
    if (refundAmount <= 0) {
      await reserveClient.query('ROLLBACK');
      reserveTransactionStarted = false;
      return res.status(400).json({ error: 'Order has already been fully refunded' });
    }
    const cumulativeRefundAmount = Math.round((alreadyRefunded + refundAmount) * 100) / 100;

    const { rows: reservedRows } = await reserveClient.query(
      `UPDATE orders
          SET refund_status = 'pending',
              refund_method = 'paystack',
              refund_amount = $1,
              refund_notes = $2,
              updated_at = NOW()
        WHERE id = $3
        RETURNING *`,
      [cumulativeRefundAmount, notes || null, order.id]
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
  let recoveredAfterTimeout = false;
  try {
    refundData = await createFullRefund({
      transactionReference,
      amount: refundAmount,
      notes,
      currency: 'GHS',
    });
  } catch (error) {
    const isAmbiguous = !error.response || error.response.status >= 500 || error.code === 'ECONNABORTED';
    let foundActiveRefund = null;
    let lookupFailed = false;
    if (isAmbiguous) {
      try {
        const existingList = await fetchRefundsByTransaction(transactionReference);
        if (Array.isArray(existingList)) {
          foundActiveRefund = existingList.find(r =>
            r && ['pending', 'processing', 'processed', 'needs-attention'].includes(String(r.status || '').toLowerCase())
          ) || null;
        }
      } catch (lookupErr) {
        lookupFailed = true;
        logger.warn('Paystack refund ambiguity lookup failed', {
          orderId: reservedOrder.id,
          err: lookupErr.message,
        });
      }
    }

    if (foundActiveRefund) {
      logger.warn('Paystack refund timed out/errored, but active refund was found on Paystack', {
        orderId: reservedOrder.id,
        transactionReference,
        refundId: foundActiveRefund.id,
        status: foundActiveRefund.status,
      });
      refundData = foundActiveRefund;
      recoveredAfterTimeout = true;
    } else {
      const failureDetail = error.response?.data?.message || error.response?.data?.error || error.message;
      const stayPending = isAmbiguous && (lookupFailed || !error.response || error.code === 'ECONNABORTED');
      const failClient = await pool.connect();
      let failTransactionStarted = false;

      try {
        await failClient.query('BEGIN');
        failTransactionStarted = true;

        if (stayPending) {
          const pendingNotes = [
            notes,
            `Paystack refund request timed out or status unconfirmed — left pending for reconciliation (${failureDetail})`,
          ]
            .filter(Boolean)
            .join('\n');

          const { rows: pendingRows } = await failClient.query(
            `UPDATE orders
                SET refund_requested_at = COALESCE(refund_requested_at, NOW()),
                    refund_notes = $1,
                    updated_at = NOW()
              WHERE id = $2
                AND refund_status = 'pending'
              RETURNING *`,
            [pendingNotes, reservedOrder.id]
          );

          await failClient.query('COMMIT');
          failTransactionStarted = false;

          logger.warn('Paystack refund request status unconfirmed; kept pending for reconciliation', {
            orderId: reservedOrder.id,
            transactionReference,
            err: failureDetail,
            lookupFailed,
          });

          return res.status(202).json({
            message: 'Refund request status unconfirmed; left pending for automatic Paystack verification',
            detail: failureDetail,
            order: pendingRows[0] || reservedOrder,
          });
        }

        const failedNotes = [notes, `Paystack refund request failed: ${failureDetail}`]
          .filter(Boolean)
          .join('\n');

        const { rows: failedRows } = await failClient.query(
          `UPDATE orders
              SET refund_status = 'failed',
                  refund_method = 'paystack',
                  refund_amount = $1,
                  refund_notes = $2,
                  updated_at = NOW()
            WHERE id = $3
              AND refund_status = 'pending'
            RETURNING *`,
          [refundAmount, failedNotes, reservedOrder.id]
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
  }

  const providerId = refundData.id || refundData.refund_id || null;
  const providerReference = reference || null;
  const psStatus = String(refundData.status || '').toLowerCase();
  const completeClient = await pool.connect();
  let completeTransactionStarted = false;

  try {
    await completeClient.query('BEGIN');
    completeTransactionStarted = true;

    let updatedRows = [];
    let auditAlert = null;
    let sendRefundEmail = false;
    let responseMessage = recoveredAfterTimeout
      ? 'Refund requested (verified after timeout)'
      : 'Refund requested';

    if (psStatus === 'processed') {
      const resProcessed = await completeClient.query(
        `UPDATE orders
            SET refund_status = 'success',
                status = 'refunded',
                payment_status = 'refunded',
                refunded_at = NOW(),
                refund_requested_at = COALESCE(refund_requested_at, NOW()),
                refund_method = 'paystack',
                refund_amount = $1,
                refund_provider_id = $2,
                refund_reference = $3,
                refund_notes = $4,
                updated_at = NOW()
          WHERE id = $5
            AND refund_status = 'pending'
          RETURNING *`,
        [refundAmount, providerId ? String(providerId) : null, providerReference, notes || null, reservedOrder.id]
      );
      updatedRows = resProcessed.rows;

      if (resProcessed.rowCount > 0) {
        await completeClient.query(
          `UPDATE payments
              SET status = 'refunded',
                  updated_at = NOW()
            WHERE order_id = $1
              AND status IN ('success', 'needs_review')`,
          [reservedOrder.id]
        );
        await logStatusChange(
          reservedOrder.id,
          reservedOrder.status,
          'refunded',
          'Paystack refund processed',
          completeClient
        );
        sendRefundEmail = true;
      }
      responseMessage = 'Order refunded';
    } else if (psStatus === 'needs-attention') {
      const detail = refundData.reason || refundData.message || refundData.gateway_response || 'needs-attention';
      const attentionNote = `Paystack refund needs attention — customer account details required (${detail})`;
      const attentionNotes = [notes, attentionNote].filter(Boolean).join('\n');

      const resAttn = await completeClient.query(
        `UPDATE orders
            SET refund_status = 'needs_attention',
                refund_requested_at = COALESCE(refund_requested_at, NOW()),
                refund_method = 'paystack',
                refund_amount = $1,
                refund_provider_id = $2,
                refund_reference = $3,
                refund_notes = $4,
                updated_at = NOW()
          WHERE id = $5
            AND refund_status = 'pending'
          RETURNING *`,
        [refundAmount, providerId ? String(providerId) : null, providerReference, attentionNotes, reservedOrder.id]
      );
      updatedRows = resAttn.rows;

      if (resAttn.rowCount > 0) {
        await logStatusChange(
          reservedOrder.id,
          reservedOrder.status,
          reservedOrder.status,
          'Paystack refund needs attention — customer account details required',
          completeClient
        );
        auditAlert = {
          orderId: reservedOrder.id,
          alertKey: `refund_needs_attention_${providerId || reservedOrder.id}`,
          title: 'Paystack refund needs attention',
          detail: attentionNote,
        };
      }
      responseMessage = 'Refund requires customer account details (needs attention)';
    } else {
      const resPending = await completeClient.query(
        `UPDATE orders
            SET refund_status = 'pending',
                refund_requested_at = NOW(),
                refund_method = 'paystack',
                refund_amount = $1,
                refund_provider_id = $2,
                refund_reference = $3,
                refund_notes = $4,
                refunded_at = NULL,
                updated_at = NOW()
          WHERE id = $5
            AND refund_status = 'pending'
          RETURNING *`,
        [refundAmount, providerId ? String(providerId) : null, providerReference, notes || null, reservedOrder.id]
      );
      updatedRows = resPending.rows;
    }

    await completeClient.query('COMMIT');
    completeTransactionStarted = false;

    if (sendRefundEmail) {
      const { notificationQueue } = require('../queues');
      notificationQueue.add('order-refunded', { orderId: reservedOrder.id })
        .catch(err => logger.error('Failed to enqueue refund notification', { err: err.message, orderId: reservedOrder.id }));
    }
    if (auditAlert) {
      const { notificationQueue } = require('../queues');
      notificationQueue.add('admin-payment-alert', auditAlert)
        .catch(err => logger.error('Failed to enqueue refund needs-attention alert', { err: err.message, orderId: reservedOrder.id }));
    }

    logger.info('Paystack refund requested', {
      orderId: reservedOrder.id,
      refundAmount,
      refundProviderId: providerId,
      refundReference: providerReference,
      paystackStatus: psStatus || 'pending',
      recoveredAfterTimeout,
    });

    return res.json({
      message: responseMessage,
      order: updatedRows[0] || reservedOrder,
    });
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
    const fulfillment_method = req.body.fulfillment_method === 'pickup' ? 'pickup' : 'delivery';
    const payment_method = req.body.payment_method === 'pay_on_delivery' ? 'pay_on_delivery' : 'paystack';
    const {
      email, first_name, last_name, phone,
      notes, items,
    } = req.body;
    let { shipping_address, shipping_city, shipping_region } = req.body;

    if (!email || !first_name || !phone) {
      return res.status(400).json({ error: 'email, first_name, and phone are required' });
    }
    if (fulfillment_method === 'delivery' && (!shipping_address || !shipping_city || !shipping_region)) {
      return res.status(400).json({ error: 'email, first_name, phone, and full shipping address are required' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    await client.query('BEGIN');
    transactionStarted = true;

    const checkoutCfg = await getCheckoutSettings(client);
    if (!checkoutCfg.guestCheckoutEnabled) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(403).json({ error: 'Please sign in or create an account to place an order.' });
    }
    const optionError = validateFulfillmentAndPayment(
      checkoutCfg, fulfillment_method, payment_method, shipping_region
    );
    if (optionError) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(400).json({ error: optionError });
    }

    if (fulfillment_method === 'pickup') {
      shipping_address = shipping_address?.trim() || `Pickup: ${checkoutCfg.pickupLocation}`;
      shipping_city    = shipping_city?.trim()    || 'Accra';
      shipping_region  = shipping_region?.trim()  || 'Greater Accra';
    }

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
        `SELECT id, product_id, price, stock_quantity, is_active FROM product_variants WHERE id = ANY($1) FOR UPDATE`,
        [variantIds]
      );
      variantMap = Object.fromEntries(variants.map(v => [v.id, v]));
    }

    for (const item of items) {
      const p = productMap[item.product_id];
      if (!p) {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return res.status(400).json({ error: `Product not found: ${item.product_id}` });
      }

      if (item.variant_id) {
        const v = variantMap[item.variant_id];
        if (!v || v.product_id !== item.product_id) {
          await client.query('ROLLBACK');
          transactionStarted = false;
          return res.status(400).json({ error: `Selected variant does not belong to product ${item.product_id}` });
        }
        if (!v.is_active) {
          await client.query('ROLLBACK');
          transactionStarted = false;
          return res.status(400).json({ error: 'Selected variant is not available' });
        }
      }

      const effectiveStock = item.variant_id && variantMap[item.variant_id]
        ? variantMap[item.variant_id].stock_quantity
        : p.stock_quantity;
      if (effectiveStock < item.quantity) {
        await client.query('ROLLBACK');
        transactionStarted = false;
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
    const delivery_fee = computeDeliveryFeeFromSettings(
      checkoutCfg, fulfillment_method, shipping_region, subtotal
    );
    let total = subtotal + delivery_fee;

    // Apply coupon discount server-side (locked — same as authenticated checkout)
    let discountAmount = 0;
    let appliedCouponCode = null;
    if (req.body.coupon_code) {
      const cv = await CouponModel.validateAndLock(req.body.coupon_code, total, client, {
        email,
      });
      if (cv.valid) {
        discountAmount    = cv.discountAmount;
        appliedCouponCode = cv.coupon.code;
        total             = Math.max(0, total - discountAmount);
      } else {
        await client.query('ROLLBACK');
        transactionStarted = false;
        return res.status(400).json({ error: cv.error || 'Invalid or expired coupon' });
      }
    }

    if (payment_method !== 'pay_on_delivery' && (!Number.isFinite(total) || Math.round(total * 100) <= 0)) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(400).json({
        error: 'Order total must be greater than zero for online payment. Please adjust your cart or coupon.',
      });
    }

    const orderId = uuid();
    const initialStatus = payment_method === 'pay_on_delivery' ? 'confirmed' : 'pending';
    const guestNotes = `Phone: ${phone}${notes ? '\n' + notes : ''}`;
    const fullNotes = `Guest: ${first_name} ${last_name || ''} <${email}>\n${guestNotes}`;

    const orderNumber = await insertOrderWithUniqueNumber(client, async (candidate) => {
      await client.query(
        `INSERT INTO orders
           (id, customer_id, order_number, total_amount, shipping_address, shipping_city,
            shipping_region, delivery_fee, ghana_post_gps, delivery_landmark,
            coupon_code, discount_amount, notes, guest_email,
            guest_first_name, guest_last_name, guest_phone,
            fulfillment_method, payment_method, status, payment_status)
         VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'unpaid')`,
        [orderId, candidate, total, shipping_address, shipping_city,
         shipping_region, delivery_fee,
         req.body.ghana_post_gps ? String(req.body.ghana_post_gps).trim().toUpperCase() : null,
         req.body.delivery_landmark ? String(req.body.delivery_landmark).trim() : null,
         appliedCouponCode, discountAmount, fullNotes, email,
         first_name, last_name || null, phone,
         fulfillment_method, payment_method, initialStatus]
      );
    });

    if (payment_method === 'pay_on_delivery') {
      await logStatusChange(
        orderId,
        'pending',
        'confirmed',
        fulfillment_method === 'pickup'
          ? 'Order confirmed (Pay on Pickup)'
          : 'Order confirmed (Pay on Delivery)',
        client
      );
    }

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
    transactionStarted = false;

    pool.query(
      `UPDATE checkout_sessions
          SET recovered_order_id = $1, updated_at = NOW()
        WHERE recovered_order_id IS NULL
          AND LOWER(email) = LOWER($2)`,
      [orderId, email]
    ).catch(() => {});

    if (payment_method === 'pay_on_delivery') {
      const { notificationQueue, shipmentQueue } = require('../queues');
      notificationQueue.add('payment-success', { orderId, reference: `POD-${orderNumber}` })
        .catch(err => logger.error('Failed to enqueue guest POD confirmation notification', { err: err.message, orderId }));
      if (fulfillment_method === 'delivery') {
        shipmentQueue.add('create-shipment', { orderId })
          .catch(err => logger.error('Failed to enqueue guest POD shipment creation', { err: err.message, orderId }));
      }
    }

    res.status(201).json({
      orderId,
      orderNumber,
      total,
      deliveryFee: delivery_fee,
      discountAmount,
      couponCode: appliedCouponCode,
      email,
      fulfillment_method,
      payment_method,
      status: initialStatus,
    });
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

    const { rows: activeReturns } = await pool.query(
      `SELECT 1 FROM return_requests WHERE order_id = $1 AND status IN ('pending', 'refund_pending') LIMIT 1`,
      [orderId]
    );
    if (activeReturns.length > 0) {
      return res.status(409).json({ error: 'An item-level return request is already pending or refunding for this order' });
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
  const reason = (req.body?.reason || req.body?.note || '').trim();

  try {
    const noteClause = reason ? `, notes = CASE WHEN notes IS NULL OR notes = '' THEN $2 ELSE notes || E'\n' || $2 END` : '';
    const params = reason ? [orderId, `[Cancellation Rejected]: ${reason}`] : [orderId];

    const result = await pool.query(
      `UPDATE orders
          SET cancel_request_rejected = true,
              updated_at = NOW()
              ${noteClause}
        WHERE id = $1 AND cancel_requested = true
        RETURNING id`,
      params
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Order not found or no cancel request pending' });
    }

    const { notificationQueue } = require('../queues');
    notificationQueue.add('cancel-rejected', { orderId, reason })
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
  const reason = (req.body?.reason || req.body?.note || '').trim();

  try {
    const noteClause = reason ? `, notes = CASE WHEN notes IS NULL OR notes = '' THEN $2 ELSE notes || E'\n' || $2 END` : '';
    const params = reason ? [orderId, `[Return Rejected]: ${reason}`] : [orderId];

    const result = await pool.query(
      `UPDATE orders
          SET return_request_rejected = true,
              updated_at = NOW()
              ${noteClause}
        WHERE id = $1 AND return_requested = true
        RETURNING id`,
      params
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Order not found or no return request pending' });
    }

    const { notificationQueue } = require('../queues');
    notificationQueue.add('return-rejected', { orderId, reason })
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
  const rawOrderNum = typeof req.body?.order_number === 'string'
    ? req.body.order_number.trim().replace(/^#+/, '').trim()
    : '';
  const rawEmail = typeof req.body?.email === 'string'
    ? req.body.email.trim().toLowerCase()
    : '';

  if (!rawOrderNum || !rawEmail) {
    return res.status(400).json({ message: 'Order number and email are required' });
  }

  try {
    const { rows: orderRows } = await pool.query(
      `SELECT o.id, o.order_number, o.status, o.payment_status,
              o.total_amount, o.delivery_fee, o.fulfillment_method,
              o.refund_status, o.refund_amount,
              o.created_at, o.updated_at,
              o.shipping_city, o.shipping_region
       FROM orders o
       LEFT JOIN users u ON o.customer_id = u.id
       WHERE (
               UPPER(o.order_number) = UPPER($1)
               OR EXISTS (
                 SELECT 1 FROM deliveries d
                  WHERE d.order_id = o.id
                    AND UPPER(d.tracking_number) = UPPER($1)
               )
             )
         AND (LOWER(TRIM(u.email)) = $2 OR LOWER(TRIM(o.guest_email)) = $2)
       LIMIT 1`,
      [rawOrderNum, rawEmail]
    );

    if (!orderRows.length) {
      return res.status(404).json({
        message: 'Order not found. Please check your order number and email address.',
      });
    }

    const order = orderRows[0];

    const [itemsResult, deliveryResult, logResult] = await Promise.all([
      pool.query(
        `SELECT oi.product_id, p.name, oi.variant_label, oi.quantity,
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
        `SELECT to_status AS status, created_at
         FROM order_status_log
         WHERE order_id = $1
         ORDER BY created_at ASC`,
        [order.id]
      ),
    ]);

    res.json({
      ...(!['paid', 'partially_refunded', 'refunded'].includes(order.payment_status) ? { id: order.id } : {}),
      order_number:       order.order_number,
      status:             order.status,
      payment_status:     order.payment_status,
      total_amount:       order.total_amount,
      delivery_fee:       order.delivery_fee,
      fulfillment_method: order.fulfillment_method,
      refund_status:      order.refund_status,
      refund_amount:      order.refund_amount,
      created_at:         order.created_at,
      updated_at:         order.updated_at,
      items:              itemsResult.rows,
      delivery:           deliveryResult.rows[0] || null,
      status_history:     logResult.rows,
      shipping_address: {
        city:   order.shipping_city,
        region: order.shipping_region,
      },
    });
  } catch (err) {
    logger.error('[trackOrder] error', { err: err.message });
    res.status(500).json({ message: 'Failed to track order' });
  }
};

// ── Admin: mark Pay-on-Delivery order as paid (Cash / MoMo collected) ─────────
const markOrderPaid = async (req, res) => {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;

    const { rows } = await client.query(
      `SELECT id, order_number, status, payment_status, payment_method, customer_id, total_amount
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
    if (order.payment_status === 'paid') {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(409).json({ error: 'Order is already marked as paid' });
    }
    if (['cancelled', 'refunded'].includes(order.status)) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(400).json({ error: `Cannot mark "${order.status}" order as paid` });
    }
    if (order.payment_method !== 'pay_on_delivery') {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(400).json({ error: 'Only Pay on Delivery orders can be manually marked paid' });
    }

    const nextStatus = order.status === 'pending' ? 'confirmed' : order.status;
    const note = (req.body?.note && String(req.body.note).trim().slice(0, 500))
      || 'Cash/MoMo collected on delivery (marked paid by admin)';

    const { rows: updatedRows } = await client.query(
      `UPDATE orders
          SET payment_status = 'paid',
              status = $1,
              updated_at = NOW()
        WHERE id = $2
        RETURNING *`,
      [nextStatus, order.id]
    );

    await logStatusChange(order.id, order.status, nextStatus, note, client);
    await client.query('COMMIT');
    transactionStarted = false;

    if (order.customer_id) {
      pool.query(
        `UPDATE customers SET total_spent = COALESCE(total_spent, 0) + $1, total_orders = COALESCE(total_orders, 0) + 1 WHERE user_id = $2`,
        [parseFloat(order.total_amount) || 0, order.customer_id]
      ).catch(err => logger.error('Failed to update customer totals on POD markPaid', { err: err.message, orderId: order.id }));
    }

    logger.info('POD order marked paid by admin', { orderId: order.id, adminId: req.user?.id });
    res.json({ message: 'Order marked as paid', order: updatedRows[0] });
  } catch (err) {
    if (transactionStarted) await client.query('ROLLBACK').catch(() => {});
    logger.error('markOrderPaid error', { err: err.message, orderId: req.params.orderId });
    res.status(500).json({ error: 'Failed to mark order as paid' });
  } finally {
    client.release();
  }
};

// ── Admin: refund a specific payment row flagged as 'duplicate' ──────────────
const refundDuplicatePayment = async (req, res) => {
  const { orderId, paymentId } = req.params;
  const notes = typeof req.body?.notes === 'string' && req.body.notes.trim()
    ? req.body.notes.trim()
    : 'Duplicate payment refund initiated by admin';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let rows;
    try {
      ({ rows } = await client.query(
        `SELECT p.id, p.order_id, p.amount, p.currency, p.status, p.payment_method, p.paystack_reference,
                o.status AS order_status, o.order_number
           FROM payments p
           JOIN orders o ON o.id = p.order_id
          WHERE p.id = $1 AND p.order_id = $2
          FOR UPDATE OF p NOWAIT`,
        [paymentId, orderId]
      ));
    } catch (lockErr) {
      await client.query('ROLLBACK').catch(() => {});
      if (lockErr.code === '55P03') {
        return res.status(409).json({ error: 'A refund for this duplicate payment is already in progress' });
      }
      throw lockErr;
    }

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Payment record not found for this order' });
    }
    const payment = rows[0];
    if (payment.status !== 'duplicate') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Only payments flagged as 'duplicate' can be refunded via this action (current status: '${payment.status}')`,
      });
    }
    if (payment.payment_method !== 'paystack' || !payment.paystack_reference) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Duplicate payment has no Paystack reference to refund' });
    }

    // Idempotency guard: if a previous attempt succeeded on Paystack but our
    // local DB write failed, Paystack already has a refund for this duplicate
    // transaction. Check Paystack first so retries can NEVER double-refund.
    let refundData = null;
    let alreadyRefundedOnPaystack = false;
    try {
      const existingRefunds = await fetchRefundsByTransaction(payment.paystack_reference);
      const activeExisting = (existingRefunds || []).find((r) =>
        ['pending', 'processing', 'processed', 'needs-attention'].includes(String(r?.status || '').toLowerCase())
      );
      if (activeExisting) {
        refundData = activeExisting;
        alreadyRefundedOnPaystack = true;
      }
    } catch (lookupErr) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error('[refundDuplicatePayment] Paystack refund lookup failed', {
        err: lookupErr.message,
        status: lookupErr.status,
        orderId,
        paymentId,
      });
      return res.status(502).json({
        error: 'Could not verify existing Paystack refunds before initiating refund; please retry',
      });
    }

    if (!alreadyRefundedOnPaystack) {
      try {
        refundData = await createFullRefund({
          transactionReference: payment.paystack_reference,
          amount: payment.amount,
          currency: payment.currency || 'GHS',
          notes,
        });
      } catch (paystackErr) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[refundDuplicatePayment] Paystack refund failed', {
          err: paystackErr.message,
          status: paystackErr.status,
          orderId,
          paymentId,
        });
        return res.status(502).json({
          error: paystackErr.message || 'Paystack refund request failed',
        });
      }
    }

    const refundRef = refundData?.id ? String(refundData.id) : 'submitted';
    const providerStatus = String(refundData?.status || 'pending').toLowerCase();
    const nextPaymentStatus = providerStatus === 'processed' ? 'refunded' : 'refund_pending';
    const amountNum = Number(payment.amount) || 0;
    const auditNote = alreadyRefundedOnPaystack
      ? `Duplicate payment refund reconciled as ${nextPaymentStatus} on Paystack (ref ${payment.paystack_reference}, ${payment.currency || 'GHS'} ${amountNum.toFixed(2)}, Paystack refund #${refundRef}, status: ${providerStatus})`
      : `Duplicate payment refund ${nextPaymentStatus === 'refunded' ? 'completed' : 'initiated'} (ref ${payment.paystack_reference}, ${payment.currency || 'GHS'} ${amountNum.toFixed(2)}, Paystack refund #${refundRef}, status: ${providerStatus}) — ${notes}`;

    const { rows: updatedRows } = await client.query(
      `UPDATE payments SET status = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING id, order_id, amount, currency, status, payment_method, paystack_reference, updated_at`,
      [paymentId, nextPaymentStatus]
    );
    await logStatusChange(orderId, payment.order_status, payment.order_status, auditNote, client);
    await client.query('COMMIT');

    return res.json({
      message: nextPaymentStatus === 'refunded'
        ? 'Duplicate payment refunded via Paystack'
        : 'Duplicate payment refund submitted to Paystack (pending confirmation)',
      already_refunded_on_paystack: alreadyRefundedOnPaystack,
      payment: updatedRows[0],
      paystack_refund: {
        id: refundData?.id || null,
        status: providerStatus,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('[refundDuplicatePayment] error', { err: err.message, orderId, paymentId });
    return res.status(500).json({ error: 'Failed to refund duplicate payment' });
  } finally {
    client.release();
  }
};

// ── Abandoned Checkout Lead Capture & Recovery ──────────────────────────────

const upsertCheckoutSession = async (req, res) => {
  try {
    const {
      session_token,
      email,
      first_name = null,
      phone = null,
      items = [],
      subtotal = 0,
      step_reached = 'contact',
      consent = false,
    } = req.body || {};

    if (consent !== true) {
      return res.status(400).json({
        error: 'Please update your app or refresh the page and tick the cart reminder consent box to save your checkout session.',
        code: 'CONSENT_REQUIRED',
      });
    }

    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanToken = String(session_token || '').trim().slice(0, 120);
    if (!cleanToken || !cleanEmail || cleanEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: 'Valid session_token and email are required' });
    }

    if (!Array.isArray(items) || items.length > 50) {
      return res.status(400).json({ error: 'items must be an array of at most 50 items' });
    }
    const safeItems = items.map(it => ({
      product_id: it?.product_id ? String(it.product_id).slice(0, 64) : null,
      name: it?.name ? String(it.name).trim().slice(0, 160) : 'Item',
      quantity: Math.max(1, Math.min(999, parseInt(it?.quantity, 10) || 1)),
      price: Math.max(0, Number(it?.price) || 0),
    }));
    const serializedItems = JSON.stringify(safeItems);
    if (serializedItems.length > 16384) {
      return res.status(400).json({ error: 'Checkout session payload exceeds maximum size' });
    }

    const parsedSubtotal = Number(subtotal);
    if (!Number.isFinite(parsedSubtotal) || parsedSubtotal < 0 || parsedSubtotal > 1000000) {
      return res.status(400).json({ error: 'Invalid subtotal' });
    }
    const safeSubtotal = parsedSubtotal;
    const safeStep = ['contact', 'shipping', 'payment'].includes(step_reached)
      ? step_reached
      : 'contact';

    await pool.query(
      `INSERT INTO checkout_sessions
         (id, session_token, customer_id, email, first_name, phone, items_json, subtotal, step_reached, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, NOW())
       ON CONFLICT (session_token) DO UPDATE SET
         customer_id  = COALESCE(EXCLUDED.customer_id, checkout_sessions.customer_id),
         email        = EXCLUDED.email,
         first_name   = COALESCE(EXCLUDED.first_name, checkout_sessions.first_name),
         phone        = COALESCE(EXCLUDED.phone, checkout_sessions.phone),
         items_json   = EXCLUDED.items_json,
         subtotal     = EXCLUDED.subtotal,
         step_reached = EXCLUDED.step_reached,
         updated_at   = NOW()
       WHERE checkout_sessions.recovered_order_id IS NULL`,
      [
        uuid(),
        cleanToken,
        req.user?.id || null,
        cleanEmail,
        first_name ? String(first_name).trim().slice(0, 100) : null,
        phone ? String(phone).trim().slice(0, 30) : null,
        JSON.stringify(safeItems),
        safeSubtotal,
        safeStep,
      ]
    );

    return res.json({ saved: true });
  } catch (err) {
    logger.error('upsertCheckoutSession error', { err: err.message });
    return res.status(500).json({ error: 'Failed to save checkout session' });
  }
};

const getAbandonedCheckouts = async (req, res) => {
  try {
    const includeRecovered = req.query.include_recovered === 'true';
    const { rows } = await pool.query(
      `SELECT cs.*
         FROM checkout_sessions cs
        ${includeRecovered ? '' : 'WHERE cs.recovered_order_id IS NULL'}
        ORDER BY cs.updated_at DESC
        LIMIT 100`
    );
    return res.json({ sessions: rows });
  } catch (err) {
    logger.error('getAbandonedCheckouts error', { err: err.message });
    return res.status(500).json({ error: 'Failed to load abandoned checkouts' });
  }
};

const sendAbandonedCheckoutReminder = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM checkout_sessions WHERE id = $1 LIMIT 1`,
      [req.params.sessionId]
    );
    const session = rows[0];
    if (!session) return res.status(404).json({ error: 'Checkout session not found' });
    if (session.recovered_order_id) {
      return res.status(409).json({ error: 'This checkout has already been completed' });
    }
    if (session.reminder_sent_at) {
      return res.status(409).json({ error: 'A recovery reminder has already been sent for this session' });
    }

    const emailService = require('../services/email.service');
    const storeUrl = (process.env.FRONTEND_URL || 'https://bodycreamgh.com').replace(/\/$/, '');
    const apiBaseUrl = (process.env.BACKEND_PUBLIC_URL || process.env.API_URL || storeUrl).replace(/\/$/, '');
    const optOutUrl = `${apiBaseUrl}/api/orders/checkout-session/opt-out?token=${encodeURIComponent(session.session_token)}`;
    const items = Array.isArray(session.items_json) ? session.items_json : [];
    const itemsHtml = items
      .map(it => `<li>${it.name || 'Item'} × ${it.quantity || 1}</li>`)
      .join('');

    await emailService.sendEmail({
      to: session.email,
      subject: 'You left something glowing in your cart ✨',
      html: `
        <p>Hi ${session.first_name || 'there'},</p>
        <p>Your BodyCream GH cart (GHS ${Number(session.subtotal || 0).toFixed(2)}) is still waiting for you:</p>
        ${itemsHtml ? `<ul>${itemsHtml}</ul>` : ''}
        <p><a href="${storeUrl}/cart" style="display:inline-block;padding:10px 18px;background:#1c1410;color:#fff;text-decoration:none;border-radius:4px;">Return to Your Cart</a></p>
        <p style="margin-top:20px;font-size:12px;color:#666;">Don't want cart reminders? <a href="${optOutUrl}">Opt out and delete your saved checkout session</a>.</p>
      `,
    });

    await pool.query(
      `UPDATE checkout_sessions SET reminder_sent_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [session.id]
    );
    const { logAdminAction } = require('../utils/audit');
    await logAdminAction({
      actorId: req.user?.id,
      actorEmail: req.userEmail,
      action: 'abandoned_checkout.remind',
      resourceType: 'checkout_session',
      resourceId: session.id,
      details: { email: session.email },
      ip: req.ip,
    });

    return res.json({ message: 'Recovery reminder email sent', reminder_sent_at: new Date().toISOString() });
  } catch (err) {
    logger.error('sendAbandonedCheckoutReminder error', { err: err.message });
    return res.status(500).json({ error: 'Failed to send recovery reminder' });
  }
};

const deleteCheckoutSession = async (req, res) => {
  try {
    const rawToken = String(
      req.query?.token || req.body?.session_token || ''
    ).trim().slice(0, 120);

    if (!rawToken && !req.user?.id) {
      return res.status(400).json({ error: 'session_token is required' });
    }

    const { rowCount } = rawToken
      ? await pool.query(
          `DELETE FROM checkout_sessions WHERE session_token = $1`,
          [rawToken]
        )
      : await pool.query(
          `DELETE FROM checkout_sessions WHERE customer_id = $1 AND recovered_order_id IS NULL`,
          [req.user.id]
        );

    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(
        '<!doctype html><html><body style="font-family:sans-serif;padding:40px;text-align:center;"><h2>You have been opted out</h2><p>Your saved checkout session has been deleted and you will not receive cart reminders.</p></body></html>'
      );
    }
    return res.json({ deleted: rowCount > 0, count: rowCount });
  } catch (err) {
    logger.error('deleteCheckoutSession error', { err: err.message });
    return res.status(500).json({ error: 'Failed to delete checkout session' });
  }
};

module.exports = {
  createOrder, createGuestOrder, getOrders, getOrderById, getAllOrders,
  getRequestCounts, getRequests, exportOrders,
  updateOrderStatus, cancelOrder, refundOrder, markOrderPaid, refundDuplicatePayment,
  getOrderStatusLog, getReviewStatus,
  requestCancel, requestReturn,
  approveCancelRequest, rejectCancelRequest,
  approveReturnRequest, rejectReturnRequest,
  trackOrder,
  upsertCheckoutSession, getAbandonedCheckouts, sendAbandonedCheckoutReminder, deleteCheckoutSession,
};

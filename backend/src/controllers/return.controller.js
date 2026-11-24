'use strict';

const { randomUUID: uuid } = require('crypto');
const pool = require('../config/database');
const InventoryModel = require('../models/inventory.model');
const { createRefund, fetchRefundById, fetchRefundsByTransaction } = require('../services/paystack.service');
const { calculateReturnRefund } = require('../utils/returnMath');
const { logStatusChange } = require('../utils/audit');
const { isAdminRole } = require('../middleware/auth');
const logger = require('../utils/logger');

const MAX_RETURN_ITEMS = 50;
const ACTIVE_COMMITTED_STATUSES = ['pending', 'refund_pending', 'refunded'];

async function getReturnWindowDays(db = pool) {
  try {
    const { rows } = await db.query(
      "SELECT value FROM site_settings WHERE key = 'return_window_days'"
    );
    const parsed = parseInt(rows[0]?.value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
  } catch {
    return 3;
  }
}

async function restoreReturnStock(client, returnRequestId, orderNumber) {
  const { rows: lines } = await client.query(
    `SELECT rri.quantity, oi.product_id, oi.variant_id, oi.variant_label
       FROM return_request_items rri
       JOIN order_items oi ON oi.id = rri.order_item_id
      WHERE rri.return_request_id = $1`,
    [returnRequestId]
  );

  const note = `Return restock (${returnRequestId.slice(0, 8)}) for order ${orderNumber}`;
  for (const line of lines) {
    const qty = Number(line.quantity);
    if (line.variant_id) {
      await client.query(
        'UPDATE product_variants SET stock_quantity = stock_quantity + $1, updated_at = NOW() WHERE id = $2',
        [qty, line.variant_id]
      );
      await client.query(
        'INSERT INTO inventory_history (id, product_id, quantity_change, reason, notes) VALUES ($1, $2, $3, $4, $5)',
        [uuid(), line.product_id, qty, 'return_restock', `${note}${line.variant_label ? ` [${line.variant_label}]` : ''}`]
      );
    } else {
      await InventoryModel.adjustStock(line.product_id, qty, 'return_restock', note, client);
    }
  }
}

/**
 * Atomically mark a return_request as 'refunded' and roll up cumulative
 * refund_amount / payment_status / status onto the parent order.
 * Must be called inside an active DB transaction with the return_request row locked.
 */
async function finalizeReturnRequestRefund(client, returnRow, { providerId = null, refundReference = null, notePrefix = 'Partial return refund completed' } = {}) {
  const { rows: [updatedRet] } = await client.query(
    `UPDATE return_requests
        SET status = 'refunded',
            refund_provider_id = COALESCE(refund_provider_id, $1),
            refund_reference = COALESCE(refund_reference, $2),
            refunded_at = COALESCE(refunded_at, NOW()),
            updated_at = NOW()
      WHERE id = $3
      RETURNING *`,
    [providerId ? String(providerId) : null, refundReference || null, returnRow.id]
  );

  // Lock parent order for rollup
  const { rows: [order] } = await client.query(
    `SELECT id, order_number, status, payment_status, total_amount, refund_amount
       FROM orders
      WHERE id = $1
      FOR UPDATE`,
    [returnRow.order_id]
  );
  if (!order) return { returnRequest: updatedRet, order: null };

  // Sum all refunded return_requests for this order
  const { rows: [sumRow] } = await client.query(
    `SELECT COALESCE(SUM(refund_amount), 0) AS total_refunded
       FROM return_requests
      WHERE order_id = $1 AND status = 'refunded'`,
    [order.id]
  );
  const cumulativeRefunded = Math.round(Number(sumRow.total_refunded || 0) * 100) / 100;
  const orderTotal = Math.round(Number(order.total_amount || 0) * 100) / 100;

  // Check if every purchased item unit on the order has now been refunded
  const { rows: [unitCheck] } = await client.query(
    `SELECT
       (SELECT COALESCE(SUM(quantity), 0) FROM order_items WHERE order_id = $1) AS total_units,
       (SELECT COALESCE(SUM(rri.quantity), 0)
          FROM return_request_items rri
          JOIN return_requests rr ON rr.id = rri.return_request_id
         WHERE rr.order_id = $1 AND rr.status = 'refunded') AS refunded_units`,
    [order.id]
  );
  const allUnitsRefunded = Number(unitCheck.total_units) > 0 &&
    Number(unitCheck.refunded_units) >= Number(unitCheck.total_units);
  const isFullyRefunded = allUnitsRefunded || cumulativeRefunded >= orderTotal;

  const nextPaymentStatus = isFullyRefunded ? 'refunded' : 'partially_refunded';
  const nextOrderStatus = isFullyRefunded ? 'refunded' : order.status;

  const { rows: [updatedOrder] } = await client.query(
    `UPDATE orders
        SET refund_amount = $1,
            payment_status = $2,
            status = $3,
            refunded_at = CASE WHEN $4 THEN COALESCE(refunded_at, NOW()) ELSE refunded_at END,
            updated_at = NOW()
      WHERE id = $5
      RETURNING *`,
    [cumulativeRefunded, nextPaymentStatus, nextOrderStatus, isFullyRefunded, order.id]
  );

  // Restore stock if admin opted in and stock wasn't restored yet
  if (updatedRet.restock_items && !updatedRet.stock_restored) {
    await restoreReturnStock(client, updatedRet.id, order.order_number);
    await client.query(
      'UPDATE return_requests SET stock_restored = TRUE, updated_at = NOW() WHERE id = $1',
      [updatedRet.id]
    );
    updatedRet.stock_restored = true;
  }

  const auditNote = `${notePrefix} (return ${updatedRet.id.slice(0, 8)}, GHS ${Number(updatedRet.refund_amount).toFixed(2)}, ref ${updatedRet.refund_reference || 'n/a'})`;
  await logStatusChange(order.id, order.status, nextOrderStatus, auditNote, client);

  return { returnRequest: updatedRet, order: updatedOrder };
}

/**
 * Find an existing Paystack refund matching our merchant_note RET- tag,
 * exact pesewa amount, and (when present on the Paystack record) transaction_reference.
 */
function matchPaystackRefundByRefAndAmount(refundList, expectedRef, expectedAmountPesewas, expectedTxRef = null) {
  if (!Array.isArray(refundList) || !expectedRef) return null;
  const refLower = String(expectedRef).toLowerCase();
  return refundList.find((r) => {
    const rNote = String(r?.merchant_note || '').toLowerCase();
    const noteMatches = rNote.includes(refLower);
    const amtMatches = Number(r?.amount) === expectedAmountPesewas;
    const txMatches = !expectedTxRef || !r?.transaction_reference || r.transaction_reference === expectedTxRef;
    return noteMatches && amtMatches && txMatches;
  }) || null;
}

// ── GET /api/orders/:orderId/returns (logged-in owner or admin) ───────────────
const getOrderReturns = async (req, res) => {
  try {
    const { orderId } = req.params;
    const isAdmin = isAdminRole(req.user?.role);

    const { rows: orderRows } = await pool.query(
      `SELECT id, customer_id, status, payment_status, total_amount, discount_amount,
              delivery_fee, refund_amount, delivered_at, updated_at
         FROM orders
        WHERE id = $1`,
      [orderId]
    );
    const order = orderRows[0];
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!isAdmin && order.customer_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const [itemsRes, returnsRes, returnItemsRes, windowDays] = await Promise.all([
      pool.query(
        `SELECT oi.id, oi.product_id, oi.variant_id, oi.variant_label, oi.quantity,
                oi.price_at_purchase, oi.subtotal, p.name AS product_name, p.image_url
           FROM order_items oi
           JOIN products p ON p.id = oi.product_id
          WHERE oi.order_id = $1
          ORDER BY oi.created_at ASC`,
        [orderId]
      ),
      pool.query(
        `SELECT * FROM return_requests WHERE order_id = $1 ORDER BY created_at DESC`,
        [orderId]
      ),
      pool.query(
        `SELECT rri.*, rr.status AS return_status, oi.product_id, oi.variant_label, p.name AS product_name
           FROM return_request_items rri
           JOIN return_requests rr ON rr.id = rri.return_request_id
           JOIN order_items oi ON oi.id = rri.order_item_id
           JOIN products p ON p.id = oi.product_id
          WHERE rr.order_id = $1`,
        [orderId]
      ),
      getReturnWindowDays(),
    ]);

    const itemsByReturnId = new Map();
    const committedQtyByItemId = new Map();
    const refundedQtyByItemId = new Map();

    for (const rri of returnItemsRes.rows) {
      if (!itemsByReturnId.has(rri.return_request_id)) {
        itemsByReturnId.set(rri.return_request_id, []);
      }
      itemsByReturnId.get(rri.return_request_id).push(rri);
      if (ACTIVE_COMMITTED_STATUSES.includes(rri.return_status)) {
        committedQtyByItemId.set(
          rri.order_item_id,
          (committedQtyByItemId.get(rri.order_item_id) || 0) + Number(rri.quantity)
        );
      }
      if (rri.return_status === 'refunded') {
        refundedQtyByItemId.set(
          rri.order_item_id,
          (refundedQtyByItemId.get(rri.order_item_id) || 0) + Number(rri.quantity)
        );
      }
    }

    const returns = returnsRes.rows.map((rr) => ({
      ...rr,
      items: itemsByReturnId.get(rr.id) || [],
    }));

    const returnable_items = itemsRes.rows.map((oi) => {
      const committed = committedQtyByItemId.get(oi.id) || 0;
      const refunded = refundedQtyByItemId.get(oi.id) || 0;
      return {
        ...oi,
        committed_quantity: committed,
        refunded_quantity: refunded,
        remaining_quantity: Math.max(0, Number(oi.quantity) - committed),
      };
    });

    const deliveredRef = order.delivered_at || null;
    const withinWindow = deliveredRef
      ? (Date.now() - new Date(deliveredRef).getTime()) <= windowDays * 24 * 60 * 60 * 1000
      : false;

    res.json({
      returns,
      returnable_items,
      return_window_days: windowDays,
      within_window: withinWindow,
      delivered_at: deliveredRef,
    });
  } catch (err) {
    logger.error('[getOrderReturns] error', { err: err.message, orderId: req.params.orderId });
    res.status(500).json({ error: 'Failed to load return requests' });
  }
};

// ── POST /api/orders/:orderId/returns (logged-in order owner only) ────────────
const createReturnRequest = async (req, res) => {
  const { orderId } = req.params;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  const requestedItems = Array.isArray(req.body?.items) ? req.body.items : [];

  if (!reason || reason.length < 3) {
    return res.status(400).json({ error: 'A return reason (at least 3 characters) is required' });
  }
  if (requestedItems.length === 0) {
    return res.status(400).json({ error: 'Select at least one item to return' });
  }
  if (requestedItems.length > MAX_RETURN_ITEMS) {
    return res.status(400).json({ error: `Cannot return more than ${MAX_RETURN_ITEMS} distinct items in a single request` });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: orderRows } = await client.query(
      `SELECT id, order_number, customer_id, status, payment_status, total_amount,
              discount_amount, delivery_fee, refund_status, delivered_at, updated_at
         FROM orders
        WHERE id = $1
        FOR UPDATE`,
      [orderId]
    );
    const order = orderRows[0];
    if (!order) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found' });
    }
    if (!order.customer_id || order.customer_id !== req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (order.status !== 'delivered') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Returns can only be requested for delivered orders' });
    }
    if (!['paid', 'partially_refunded'].includes(order.payment_status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Only paid orders are eligible for return' });
    }
    if (['pending', 'needs_attention', 'success'].includes(order.refund_status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'A full order refund is already in progress or completed' });
    }

    // Enforce return window using orders.delivered_at (explicitly block if delivered_at is NULL)
    const windowDays = await getReturnWindowDays(client);
    if (!order.delivered_at) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Delivery date could not be verified for this order. Please contact support so an admin can process your return manually.',
      });
    }
    if ((Date.now() - new Date(order.delivered_at).getTime()) > windowDays * 24 * 60 * 60 * 1000) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Return window of ${windowDays} days after delivery has expired` });
    }

    const { rows: orderItems } = await client.query(
      'SELECT id, quantity, price_at_purchase, subtotal FROM order_items WHERE order_id = $1',
      [orderId]
    );

    // Fetch already committed quantities & item refund pesewas
    const { rows: committedRows } = await client.query(
      `SELECT rri.order_item_id,
              COALESCE(SUM(rri.quantity), 0)::int AS qty,
              COALESCE(SUM(rri.line_refund_amount), 0) AS line_sum
         FROM return_request_items rri
         JOIN return_requests rr ON rr.id = rri.return_request_id
        WHERE rr.order_id = $1
          AND rr.status = ANY($2::varchar[])
        GROUP BY rri.order_item_id`,
      [orderId, ACTIVE_COMMITTED_STATUSES]
    );

    const committedQtyMap = new Map();
    let alreadyCommittedItemRefundPesewas = 0;
    for (const r of committedRows) {
      committedQtyMap.set(r.order_item_id, Number(r.qty));
      alreadyCommittedItemRefundPesewas += Math.round(Number(r.line_sum) * 100);
    }

    let calc;
    try {
      calc = calculateReturnRefund({
        orderItems,
        discountAmount: order.discount_amount || 0,
        alreadyCommittedQtyByItemId: committedQtyMap,
        alreadyCommittedItemRefundPesewas,
        requestedItems,
      });
    } catch (calcErr) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: calcErr.message });
    }

    if (calc.totalRefundPesewas <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Calculated refund amount must be greater than zero' });
    }

    const returnId = uuid();
    const { rows: [createdReturn] } = await client.query(
      `INSERT INTO return_requests
         (id, order_id, customer_id, status, reason, refund_amount, created_at, updated_at)
       VALUES ($1, $2, $3, 'pending', $4, $5, NOW(), NOW())
       RETURNING *`,
      [returnId, orderId, req.user.id, reason, calc.totalRefundAmount]
    );

    for (const line of calc.lines) {
      await client.query(
        `INSERT INTO return_request_items
           (id, return_request_id, order_item_id, quantity, unit_refund_amount, line_refund_amount)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [uuid(), returnId, line.order_item_id, line.quantity, line.unit_refund_amount, line.line_refund_amount]
      );
    }

    await logStatusChange(
      orderId,
      order.status,
      order.status,
      `Customer requested partial return (${returnId.slice(0, 8)}, ${calc.lines.length} line(s), est. GHS ${calc.totalRefundAmount.toFixed(2)}): ${reason}`,
      client
    );

    await client.query('COMMIT');

    const { notificationQueue } = require('../queues');
    notificationQueue.add('return-requested', { orderId, returnId }, { singletonKey: `return_requested_${returnId}` })
      .catch(err => logger.error('Failed to enqueue return-requested notification', { err: err.message, orderId, returnId }));

    res.status(201).json({
      message: 'Return request submitted',
      return_request: { ...createdReturn, items: calc.lines },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('[createReturnRequest] error', { err: err.message, orderId });
    res.status(500).json({ error: 'Failed to submit return request' });
  } finally {
    client.release();
  }
};

// ── POST /api/orders/:orderId/returns/:returnId/cancel (owner only) ───────────
const cancelReturnRequest = async (req, res) => {
  const { orderId, returnId } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT rr.*, o.status AS order_status
         FROM return_requests rr
         JOIN orders o ON o.id = rr.order_id
        WHERE rr.id = $1 AND rr.order_id = $2
        FOR UPDATE OF rr`,
      [returnId, orderId]
    );
    const rr = rows[0];
    if (!rr) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Return request not found' });
    }
    if (rr.customer_id !== req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (rr.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Only pending return requests can be cancelled (current status: '${rr.status}')` });
    }

    const { rows: [updated] } = await client.query(
      `UPDATE return_requests SET status = 'cancelled', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [returnId]
    );
    await logStatusChange(orderId, rr.order_status, rr.order_status, `Customer cancelled return request (${returnId.slice(0, 8)})`, client);
    await client.query('COMMIT');
    res.json({ message: 'Return request cancelled', return_request: updated });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('[cancelReturnRequest] error', { err: err.message, orderId, returnId });
    res.status(500).json({ error: 'Failed to cancel return request' });
  } finally {
    client.release();
  }
};

// ── POST /api/orders/admin/:orderId/returns (admin-only, bypasses window/delivered_at) ──
const adminCreateReturnRequest = async (req, res) => {
  if (!req.user || !isAdminRole(req.user.role)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  const { orderId } = req.params;
  const adminId = req.user.id;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  const requestedItems = Array.isArray(req.body?.items) ? req.body.items : [];

  if (!reason || reason.length < 3) {
    return res.status(400).json({ error: 'A return reason (at least 3 characters) is required' });
  }
  if (requestedItems.length === 0) {
    return res.status(400).json({ error: 'Select at least one item to return' });
  }
  if (requestedItems.length > MAX_RETURN_ITEMS) {
    return res.status(400).json({ error: `Cannot return more than ${MAX_RETURN_ITEMS} distinct items in a single request` });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: orderRows } = await client.query(
      `SELECT id, order_number, customer_id, status, payment_status, total_amount,
              discount_amount, delivery_fee, refund_status
         FROM orders
        WHERE id = $1
        FOR UPDATE`,
      [orderId]
    );
    const order = orderRows[0];
    if (!order) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Order not found' });
    }
    if (order.status !== 'delivered') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Returns can only be created for delivered orders' });
    }
    if (!['paid', 'partially_refunded'].includes(order.payment_status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Only paid or partially refunded orders are eligible for return' });
    }
    if (['pending', 'needs_attention', 'success'].includes(order.refund_status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'A full order refund is already in progress or completed' });
    }

    const { rows: orderItems } = await client.query(
      'SELECT id, quantity, price_at_purchase, subtotal FROM order_items WHERE order_id = $1',
      [orderId]
    );
    const { rows: committedRows } = await client.query(
      `SELECT rri.order_item_id,
              COALESCE(SUM(rri.quantity), 0)::int AS qty,
              COALESCE(SUM(rri.line_refund_amount), 0) AS line_sum
         FROM return_request_items rri
         JOIN return_requests rr ON rr.id = rri.return_request_id
        WHERE rr.order_id = $1
          AND rr.status = ANY($2::varchar[])
        GROUP BY rri.order_item_id`,
      [orderId, ACTIVE_COMMITTED_STATUSES]
    );

    const committedQtyMap = new Map();
    let alreadyCommittedItemRefundPesewas = 0;
    for (const r of committedRows) {
      committedQtyMap.set(r.order_item_id, Number(r.qty));
      alreadyCommittedItemRefundPesewas += Math.round(Number(r.line_sum) * 100);
    }

    let calc;
    try {
      calc = calculateReturnRefund({
        orderItems,
        discountAmount: order.discount_amount || 0,
        alreadyCommittedQtyByItemId: committedQtyMap,
        alreadyCommittedItemRefundPesewas,
        requestedItems,
      });
    } catch (calcErr) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: calcErr.message });
    }

    if (calc.totalRefundPesewas <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Calculated refund amount must be greater than zero' });
    }

    const returnId = uuid();
    const { rows: [createdReturn] } = await client.query(
      `INSERT INTO return_requests
         (id, order_id, customer_id, status, reason, admin_note, refund_amount, created_at, updated_at)
       VALUES ($1, $2, $3, 'pending', $4, $5, $6, NOW(), NOW())
       RETURNING *`,
      [returnId, orderId, order.customer_id || adminId, reason, `Created on customer behalf by admin ${adminId} (window override)`, calc.totalRefundAmount]
    );

    for (const line of calc.lines) {
      await client.query(
        `INSERT INTO return_request_items
           (id, return_request_id, order_item_id, quantity, unit_refund_amount, line_refund_amount)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [uuid(), returnId, line.order_item_id, line.quantity, line.unit_refund_amount, line.line_refund_amount]
      );
    }

    await logStatusChange(
      orderId,
      order.status,
      order.status,
      `Admin ${adminId} created partial return on behalf of customer (${returnId.slice(0, 8)}, ${calc.lines.length} line(s), est. GHS ${calc.totalRefundAmount.toFixed(2)}, window override): ${reason}`,
      client
    );

    await client.query('COMMIT');
    res.status(201).json({
      message: 'Return request created by admin',
      return_request: { ...createdReturn, items: calc.lines },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('[adminCreateReturnRequest] error', { err: err.message, orderId });
    res.status(500).json({ error: 'Failed to create return request' });
  } finally {
    client.release();
  }
};

// ── GET /api/orders/admin/returns (admin only) ────────────────────────────────
const getAdminReturns = async (req, res) => {
  try {
    const status = typeof req.query.status === 'string' && req.query.status.trim() ? req.query.status.trim() : null;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const params = [];
    const where = status ? (params.push(status), `WHERE rr.status = $1`) : '';
    params.push(limit, offset);

    const { rows } = await pool.query(
      `SELECT rr.*, o.order_number, o.total_amount AS order_total, o.payment_method,
              u.email AS customer_email, u.first_name, u.last_name
         FROM return_requests rr
         JOIN orders o ON o.id = rr.order_id
         LEFT JOIN users u ON u.id = rr.customer_id
         ${where}
        ORDER BY rr.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({ returns: rows, page, limit });
  } catch (err) {
    logger.error('[getAdminReturns] error', { err: err.message });
    res.status(500).json({ error: 'Failed to load return requests' });
  }
};

// ── POST /api/orders/admin/returns/:returnId/approve (admin only) ─────────────
// Handles both initial approval (pending -> refund_pending/refunded)
// and retry after Paystack failure (refund_failed -> refund_pending/refunded).
const approveReturnRequestById = async (req, res) => {
  const { returnId } = req.params;
  const adminId = req.user.id;
  const requestedMethod = req.body?.method; // optional: 'paystack' | 'manual'
  const restockItems = Boolean(req.body?.restock_items);
  const includeDeliveryFee = Boolean(req.body?.include_delivery_fee);
  const adminNote = typeof req.body?.admin_note === 'string' && req.body.admin_note.trim()
    ? req.body.admin_note.trim()
    : null;
  const manualReference = typeof req.body?.reference === 'string' && req.body.reference.trim()
    ? req.body.reference.trim()
    : null;

  // Step 1: Lock return_request + order, compute final refund amount, write
  // self-generated refund_reference & status='refund_pending' BEFORE calling Paystack.
  let reserved = null;
  let paystackTxRef = null;
  let prevRefForRetryCheck = null;
  let prevProviderIdForRetryCheck = null;
  let isManual = false;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let rrRows;
    try {
      ({ rows: rrRows } = await client.query(
        `SELECT * FROM return_requests WHERE id = $1 FOR UPDATE NOWAIT`,
        [returnId]
      ));
    } catch (lockErr) {
      await client.query('ROLLBACK').catch(() => {});
      if (lockErr.code === '55P03') {
        return res.status(409).json({ error: 'Return approval is already in progress' });
      }
      throw lockErr;
    }

    const rr = rrRows[0];
    if (!rr) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Return request not found' });
    }
    if (!['pending', 'refund_failed'].includes(rr.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Only pending or refund_failed return requests can be approved/retried (current status: '${rr.status}')`,
      });
    }

    const { rows: [order] } = await client.query(
      `SELECT id, order_number, status, payment_status, total_amount, delivery_fee,
              refund_amount, payment_reference, payment_method
         FROM orders
        WHERE id = $1
        FOR UPDATE`,
      [rr.order_id]
    );
    if (!order) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Parent order not found' });
    }

    // Find winning Paystack transaction reference (if paid via Paystack)
    const { rows: payRows } = await client.query(
      `SELECT paystack_reference
         FROM payments
        WHERE order_id = $1 AND payment_method = 'paystack' AND status IN ('success', 'needs_review')
        ORDER BY CASE WHEN status = 'success' THEN 1 ELSE 2 END, updated_at DESC
        LIMIT 1`,
      [order.id]
    );
    paystackTxRef = payRows[0]?.paystack_reference || (order.payment_method === 'paystack' ? order.payment_reference : null);
    isManual = requestedMethod === 'manual' || !paystackTxRef;

    // On initial approval from 'pending', optionally add delivery_fee (capped at remaining refundable order balance)
    let finalRefundAmount = Number(rr.refund_amount);
    let finalIncludeDelivery = rr.include_delivery_fee;
    let finalRestock = rr.restock_items;

    if (rr.status === 'pending') {
      finalRestock = restockItems;
      finalIncludeDelivery = includeDeliveryFee;
      if (includeDeliveryFee && Number(order.delivery_fee || 0) > 0) {
        const orderTotalPesewas = Math.round(Number(order.total_amount) * 100);
        const alreadyRefundedPesewas = Math.round(Number(order.refund_amount || 0) * 100);
        const deliveryPesewas = Math.round(Number(order.delivery_fee) * 100);
        const basePesewas = Math.round(finalRefundAmount * 100);
        const cappedPesewas = Math.min(orderTotalPesewas - alreadyRefundedPesewas, basePesewas + deliveryPesewas);
        finalRefundAmount = Math.max(basePesewas, cappedPesewas) / 100;
      }
    }

    if (isManual) {
      const ref = manualReference || `RET-MANUAL-${returnId.replace(/-/g, '').slice(0, 12).toUpperCase()}`;
      await client.query(
        `UPDATE return_requests
            SET restock_items = $1,
                include_delivery_fee = $2,
                refund_amount = $3,
                refund_method = 'manual',
                refund_reference = $4,
                admin_note = COALESCE($5, admin_note),
                reviewed_by = $6,
                reviewed_at = COALESCE(reviewed_at, NOW()),
                updated_at = NOW()
          WHERE id = $7`,
        [finalRestock, finalIncludeDelivery, finalRefundAmount, ref, adminNote, adminId, returnId]
      );
      const { rows: [lockedForFinal] } = await client.query('SELECT * FROM return_requests WHERE id = $1', [returnId]);
      const finalized = await finalizeReturnRequestRefund(client, lockedForFinal, {
        refundReference: ref,
        notePrefix: `Manual partial return refund approved by admin ${adminId}`,
      });
      await client.query('COMMIT');
      const { notificationQueue } = require('../queues');
      notificationQueue.add('return-approved', { orderId: order.id, returnId }, { singletonKey: `return_approved_${returnId}` }).catch(() => {});
      notificationQueue.add('return-refunded', { orderId: order.id, returnId }, { singletonKey: `return_refunded_${returnId}` }).catch(() => {});
      return res.json({
        message: 'Return approved and manually refunded',
        return_request: finalized.returnRequest,
        order: finalized.order,
      });
    }

    // Paystack path: write status='refund_pending' with self-generated reference BEFORE calling Paystack
    prevRefForRetryCheck = rr.status === 'refund_failed' ? rr.refund_reference : null;
    prevProviderIdForRetryCheck = rr.status === 'refund_failed' ? rr.refund_provider_id : null;
    const nextAttempt = Number(rr.refund_attempt || 0) + 1;
    const selfRef = `RET-${returnId.replace(/-/g, '').slice(0, 12).toUpperCase()}-${nextAttempt}`;

    const { rows: [updatedReserved] } = await client.query(
      `UPDATE return_requests
          SET status = 'refund_pending',
              restock_items = $1,
              include_delivery_fee = $2,
              refund_amount = $3,
              refund_method = 'paystack',
              refund_reference = $4,
              refund_attempt = $5,
              admin_note = COALESCE($6, admin_note),
              reviewed_by = $7,
              reviewed_at = COALESCE(reviewed_at, NOW()),
              updated_at = NOW()
        WHERE id = $8
        RETURNING *`,
      [finalRestock, finalIncludeDelivery, finalRefundAmount, selfRef, nextAttempt, adminNote, adminId, returnId]
    );
    await client.query('COMMIT');
    reserved = updatedReserved;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('[approveReturnRequestById] reserve error', { err: err.message, returnId });
    return res.status(500).json({ error: 'Failed to reserve return request for refund' });
  } finally {
    client.release();
  }

  // Step 2: If retrying from refund_failed, check Paystack in strict order:
  //   (a) provider id (refund_provider_id)
  //   (b) RET- tag in merchant_note + transaction reference
  //   (c) transaction reference + exact amount ONLY if exactly one candidate (alert admin if ambiguous)
  const expectedAmountPesewas = Math.round(Number(reserved.refund_amount) * 100);
  const ACTIVE_PAYSTACK_STATUSES = new Set(['pending', 'processing', 'processed', 'needs-attention']);
  let refundData = null;
  let reusedExisting = false;

  if (prevProviderIdForRetryCheck || prevRefForRetryCheck) {
    try {
      // (a) Provider ID lookup
      if (prevProviderIdForRetryCheck) {
        const byId = await fetchRefundById(prevProviderIdForRetryCheck);
        if (byId && ACTIVE_PAYSTACK_STATUSES.has(String(byId.status || '').toLowerCase())) {
          refundData = byId;
          reusedExisting = true;
        }
      }

      // (b) RET- tag in merchant_note + transaction reference
      if (!reusedExisting) {
        const existingList = await fetchRefundsByTransaction(paystackTxRef);
        const byNote = prevRefForRetryCheck
          ? matchPaystackRefundByRefAndAmount(existingList, prevRefForRetryCheck, expectedAmountPesewas, paystackTxRef)
          : null;
        if (byNote && ACTIVE_PAYSTACK_STATUSES.has(String(byNote.status || '').toLowerCase())) {
          refundData = byNote;
          reusedExisting = true;
        } else if (Array.isArray(existingList) && existingList.length > 0) {
          // (c) Transaction reference + exact amount only if unambiguous (1 local candidate, 1 unclaimed active Paystack refund)
          const { rows: claimedRows } = await pool.query(
            `SELECT refund_provider_id FROM return_requests WHERE order_id = $1 AND id <> $2 AND refund_provider_id IS NOT NULL`,
            [reserved.order_id, returnId]
          );
          const claimedIds = new Set(claimedRows.map(r => String(r.refund_provider_id)));
          const unclaimedActive = existingList.filter((r) => {
            const st = String(r?.status || '').toLowerCase();
            const rId = r?.id ? String(r.id) : null;
            const txOk = !r?.transaction_reference || r.transaction_reference === paystackTxRef;
            return ACTIVE_PAYSTACK_STATUSES.has(st) &&
              Number(r?.amount) === expectedAmountPesewas &&
              txOk &&
              (!rId || !claimedIds.has(rId));
          });

          if (unclaimedActive.length > 0) {
            const { rows: [cntRow] } = await pool.query(
              `SELECT COUNT(*)::int AS cnt
                 FROM return_requests
                WHERE order_id = $1
                  AND status IN ('refund_pending', 'refund_failed')
                  AND ROUND(refund_amount * 100)::int = $2`,
              [reserved.order_id, expectedAmountPesewas]
            );
            const localCandidates = Number(cntRow?.cnt || 0);
            if (localCandidates === 1 && unclaimedActive.length === 1) {
              refundData = unclaimedActive[0];
              reusedExisting = true;
            } else {
              await pool.query(
                `UPDATE return_requests SET status = 'refund_failed', updated_at = NOW() WHERE id = $1 AND status = 'refund_pending'`,
                [returnId]
              ).catch(() => {});
              const { notificationQueue } = require('../queues');
              const alertKey = `ambiguous_return_retry_${returnId}_${reserved.refund_attempt}`;
              notificationQueue.add(
                'admin-payment-alert',
                {
                  orderId: reserved.order_id,
                  alertKey,
                  title: 'Ambiguous Paystack refund on retry',
                  detail: `Retry for return ${returnId.slice(0, 8)} (GHS ${Number(reserved.refund_amount).toFixed(2)}) found ${unclaimedActive.length} unclaimed Paystack refund(s) across ${localCandidates} equal-amount return(s) without a matching RET- tag. Not auto-resolved; inspect Paystack manually.`,
                },
                { singletonKey: alertKey }
              ).catch(() => {});
              return res.status(409).json({
                error: 'Ambiguous existing Paystack refund(s) found for this amount; admin alert raised for manual review',
              });
            }
          }
        }
      }
    } catch (lookupErr) {
      logger.error('[approveReturnRequestById] Paystack lookup failed on retry', {
        err: lookupErr.message, returnId,
      });
      await pool.query(
        `UPDATE return_requests SET status = 'refund_failed', updated_at = NOW() WHERE id = $1 AND status = 'refund_pending'`,
        [returnId]
      ).catch(() => {});
      return res.status(502).json({ error: 'Could not verify prior Paystack refund before retry; please try again' });
    }
  }

  if (!reusedExisting) {
    try {
      const merchantNote = `Return ${reserved.refund_reference}${adminNote ? ` — ${adminNote}` : ''}`;
      refundData = await createRefund({
        transactionReference: paystackTxRef,
        amount: reserved.refund_amount,
        currency: 'GHS',
        notes: merchantNote,
      });

      // Verify Paystack echoed our RET- tag in merchant_note; if not, log a warning (no secrets)
      // and rely on the stored refund_provider_id for webhook/reconciler matching.
      const echoedNote = typeof refundData?.merchant_note === 'string' ? refundData.merchant_note : '';
      if (!echoedNote.toUpperCase().includes(String(reserved.refund_reference).toUpperCase())) {
        logger.warn('[approveReturnRequestById] Paystack Create Refund response did not preserve RET- tag in merchant_note; relying on stored provider id', {
          returnId,
          refundProviderId: refundData?.id ? String(refundData.id) : null,
          hasMerchantNote: Boolean(echoedNote),
        });
      }
    } catch (paystackErr) {
      logger.error('[approveReturnRequestById] Paystack refund call failed', {
        err: paystackErr.message, status: paystackErr.status, returnId,
      });
      // Mark refund_failed with the provider error message and alert admin
      // (on network timeout, leave refund_pending for reconciliation or reference-matched retry)
      const isTimeout = paystackErr.code === 'ECONNABORTED' || paystackErr.code === 'ETIMEDOUT';
      const errDetail = paystackErr.message || 'Paystack partial refund request failed';
      if (!isTimeout) {
        await pool.query(
          `UPDATE return_requests
              SET status = 'refund_failed',
                  admin_note = CASE
                    WHEN admin_note IS NULL OR admin_note = '' THEN $2
                    ELSE admin_note || E'\n' || $2
                  END,
                  updated_at = NOW()
            WHERE id = $1 AND status = 'refund_pending'`,
          [returnId, `Paystack refund error: ${errDetail}`]
        ).catch(() => {});
        const { notificationQueue } = require('../queues');
        const alertKey = `ret_refund_api_err_${returnId}_${reserved.refund_attempt}`;
        notificationQueue.add(
          'admin-payment-alert',
          {
            orderId: reserved.order_id,
            alertKey,
            title: 'Partial return refund failed on Paystack',
            detail: `Return ${returnId.slice(0, 8)} (ref ${reserved.refund_reference}, GHS ${Number(reserved.refund_amount).toFixed(2)}) failed: ${errDetail}`,
          },
          { singletonKey: alertKey }
        ).catch(() => {});
      }
      return res.status(502).json({
        error: errDetail,
      });
    }
  }

  // Step 3: Persist Paystack refund_provider_id; finalize immediately only if 'processed'
  const providerId = refundData?.id ? String(refundData.id) : null;
  const providerStatus = String(refundData?.status || 'pending').toLowerCase();
  const effectiveRef = reusedExisting ? prevRefForRetryCheck : reserved.refund_reference;

  const postClient = await pool.connect();
  try {
    await postClient.query('BEGIN');
    const { rows: [locked] } = await postClient.query(
      'SELECT * FROM return_requests WHERE id = $1 FOR UPDATE',
      [returnId]
    );
    if (!locked) {
      await postClient.query('ROLLBACK');
      return res.status(404).json({ error: 'Return request not found' });
    }

    if (locked.status === 'refunded') {
      const { rows: [alreadyDone] } = await postClient.query(
        `UPDATE return_requests
            SET refund_provider_id = COALESCE(refund_provider_id, $1),
                updated_at = NOW()
          WHERE id = $2
          RETURNING *`,
        [providerId, returnId]
      );
      await postClient.query('COMMIT');
      return res.json({
        message: 'Return approved and refunded via Paystack',
        return_request: alreadyDone,
        paystack_refund: { id: providerId, status: providerStatus },
      });
    }

    if (providerStatus === 'processed') {
      const finalized = await finalizeReturnRequestRefund(postClient, locked, {
        providerId,
        refundReference: effectiveRef,
        notePrefix: 'Paystack partial return refund completed',
      });
      await postClient.query('COMMIT');
      const { notificationQueue } = require('../queues');
      notificationQueue.add('return-approved', { orderId: locked.order_id, returnId }, { singletonKey: `return_approved_${returnId}` }).catch(() => {});
      notificationQueue.add('return-refunded', { orderId: locked.order_id, returnId }, { singletonKey: `return_refunded_${returnId}` }).catch(() => {});
      return res.json({
        message: 'Return approved and refunded via Paystack',
        return_request: finalized.returnRequest,
        order: finalized.order,
        paystack_refund: { id: providerId, status: providerStatus },
      });
    }

    const { rows: [pendingRow] } = await postClient.query(
      `UPDATE return_requests
          SET status = 'refund_pending',
              refund_provider_id = COALESCE(refund_provider_id, $1),
              refund_reference = $2,
              updated_at = NOW()
        WHERE id = $3
        RETURNING *`,
      [providerId, effectiveRef, returnId]
    );
    await postClient.query('COMMIT');
    const { notificationQueue } = require('../queues');
    notificationQueue.add('return-approved', { orderId: locked.order_id, returnId }, { singletonKey: `return_approved_${returnId}` }).catch(() => {});
    return res.json({
      message: 'Return approved; Paystack partial refund is pending confirmation',
      return_request: pendingRow,
      paystack_refund: { id: providerId, status: providerStatus },
    });
  } catch (dbErr) {
    await postClient.query('ROLLBACK').catch(() => {});
    logger.error('[approveReturnRequestById] post-Paystack update failed', { err: dbErr.message, returnId });
    return res.status(500).json({ error: 'Refund submitted to Paystack; reconciliation will finalize local status' });
  } finally {
    postClient.release();
  }
};

// ── POST /api/orders/admin/returns/:returnId/reject (admin only) ──────────────
const rejectReturnRequestById = async (req, res) => {
  const { returnId } = req.params;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT rr.*, o.status AS order_status
         FROM return_requests rr
         JOIN orders o ON o.id = rr.order_id
        WHERE rr.id = $1
        FOR UPDATE OF rr`,
      [returnId]
    );
    const rr = rows[0];
    if (!rr) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Return request not found' });
    }
    if (rr.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Only pending return requests can be rejected (current status: '${rr.status}')` });
    }

    const { rows: [updated] } = await client.query(
      `UPDATE return_requests
          SET status = 'rejected',
              admin_note = $1,
              reviewed_by = $2,
              reviewed_at = NOW(),
              updated_at = NOW()
        WHERE id = $3
        RETURNING *`,
      [reason || null, req.user.id, returnId]
    );
    await logStatusChange(
      rr.order_id,
      rr.order_status,
      rr.order_status,
      `Admin rejected partial return (${returnId.slice(0, 8)})${reason ? `: ${reason}` : ''}`,
      client
    );
    await client.query('COMMIT');

    const { notificationQueue } = require('../queues');
    notificationQueue.add('return-rejected', { orderId: rr.order_id, returnId, reason }, { singletonKey: `return_rejected_${returnId}` })
      .catch(err => logger.error('Failed to enqueue return-rejected notification', { err: err.message, orderId: rr.order_id }));

    res.json({ message: 'Return request rejected', return_request: updated });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('[rejectReturnRequestById] error', { err: err.message, returnId });
    res.status(500).json({ error: 'Failed to reject return request' });
  } finally {
    client.release();
  }
};

module.exports = {
  getReturnWindowDays,
  getOrderReturns,
  createReturnRequest,
  adminCreateReturnRequest,
  cancelReturnRequest,
  getAdminReturns,
  approveReturnRequestById,
  rejectReturnRequestById,
  finalizeReturnRequestRefund,
  matchPaystackRefundByRefAndAmount,
  MAX_RETURN_ITEMS,
};

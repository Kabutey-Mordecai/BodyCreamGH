'use strict';

const crypto = require('crypto');
const { randomUUID: uuid } = require('crypto');
const pool = require('../config/database');
const paystackAPI = require('../config/paystack');
const OrderModel = require('../models/order.model');
const { logStatusChange } = require('../utils/audit');
const logger = require('../utils/logger');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAYSTACK_REF_RE = /^[A-Za-z0-9_.=-]{6,100}$/;

const NON_FINAL_TX_STATUSES = new Set(['abandoned', 'ongoing', 'pending', 'processing', 'queued']);
const FAILED_TX_STATUSES = new Set(['failed', 'reversed']);
const TERMINAL_ORDER_STATUSES = new Set(['cancelled', 'refunded']);
const ELIGIBLE_INIT_ORDER_STATUSES = new Set(['pending', 'confirmed']);
const PAYABLE_STATUSES = new Set(['unpaid', 'pending']);

const REFUND_SUCCESS_EVENTS = new Set(['refund.processed']);
const REFUND_FAILED_EVENTS = new Set(['refund.failed']);
const REFUND_STATUS_EVENTS = new Set([
  'refund.pending',
  'refund.processing',
]);
const DISPUTE_EVENTS = new Set([
  'charge.dispute.create',
  'charge.dispute.remind',
  'charge.dispute.resolve',
]);

// ── Initialize payment (shared helpers) ───────────────────────────────────────
// An open Paystack transaction for an order is reused for a short window instead
// of minting a new reference on every init call. Older references are never
// marked abandoned/failed here: the customer may still pay on an old tab, and
// verifyPayment / the webhook / duplicate-payment detection must keep working.
const REUSE_WINDOW_MINUTES = 30;
const REUSE_COLUMNS = ['authorization_url', 'access_code', 'currency'];
const REUSE_COLUMN_NEGATIVE_TTL_MS = 60 * 1000;
const reuseColumnCache = { present: null, checkedAt: 0 };

// Test hook: forget the cached "do the reuse columns exist" answer.
function _resetReuseColumnCache() {
  reuseColumnCache.present = null;
  reuseColumnCache.checkedAt = 0;
}

// The reuse columns come from migration 033. Until it is applied we fall back to
// the previous behaviour (always create a new transaction) instead of failing.
// Negative results expire after REUSE_COLUMN_NEGATIVE_TTL_MS (60s), so once 033
// is applied the process picks it up automatically on the next init call without
// requiring a restart. If a cached positive result ever hits undefined_column
// (42703), the cache is invalidated so the next call re-checks.
async function hasReuseColumns(queryable) {
  const now = Date.now();
  if (reuseColumnCache.present === true) return true;
  if (reuseColumnCache.present === false && now - reuseColumnCache.checkedAt < REUSE_COLUMN_NEGATIVE_TTL_MS) {
    return false;
  }
  const { rows } = await queryable.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'payments'
        AND column_name = ANY($1::text[])`,
    [REUSE_COLUMNS]
  );
  reuseColumnCache.present = rows.length === REUSE_COLUMNS.length;
  reuseColumnCache.checkedAt = now;
  return reuseColumnCache.present;
}

function toPesewas(order) {
  return Math.round(parseFloat(order.total_amount) * 100);
}

// Shared eligibility checks for authenticated and guest init (same order and
// messages as before). Returns { status, error } or null when payable.
function getInitError(order) {
  if (order.payment_method && order.payment_method !== 'paystack') {
    return { status: 400, error: 'This order is not configured for Paystack payment' };
  }
  if (!ELIGIBLE_INIT_ORDER_STATUSES.has(order.status)) {
    return { status: 400, error: `Cannot initialize payment for order with status "${order.status}"` };
  }
  if (order.payment_status === 'paid') {
    return { status: 400, error: 'Order already paid' };
  }
  if (!PAYABLE_STATUSES.has(order.payment_status)) {
    return { status: 400, error: `Cannot initialize payment when payment status is "${order.payment_status}"` };
  }
  const amountPesewas = toPesewas(order);
  if (!Number.isFinite(amountPesewas) || amountPesewas <= 0) {
    return { status: 400, error: 'Order total must be greater than zero for Paystack payment' };
  }
  return null;
}

function isPaystackCheckoutUrl(url) {
  try {
    return new URL(url).origin === 'https://checkout.paystack.com';
  } catch {
    return false;
  }
}

// Newest pending, recent transaction for this order with the same amount and
// currency, or null. Must run under the per-order advisory lock.
async function findReusableTransaction(client, orderId, amountPesewas) {
  const { rows } = await client.query(
    `SELECT paystack_reference, authorization_url, access_code, amount, currency
       FROM payments
      WHERE order_id = $1
        AND payment_method = 'paystack'
        AND status = 'pending'
        AND authorization_url IS NOT NULL
        AND created_at > (CURRENT_TIMESTAMP - ($2::int * INTERVAL '1 minute'))
      ORDER BY created_at DESC
      LIMIT 5`,
    [orderId, REUSE_WINDOW_MINUTES]
  );
  return rows.find(r =>
    Math.round(parseFloat(r.amount) * 100) === amountPesewas &&
    (r.currency || 'GHS') === 'GHS' &&
    isPaystackCheckoutUrl(r.authorization_url)
  ) || null;
}

// In-process per-order mutex so simultaneous init requests in this process
// serialize in memory without holding a PostgreSQL connection during the
// Paystack HTTP call. A short DB transaction with pg_advisory_xact_lock is
// then used only when persisting the new row (to guard cross-process races).
const orderInitLocks = new Map();

async function withOrderInitLock(orderId, fn) {
  const prev = orderInitLocks.get(orderId) || Promise.resolve();
  let release;
  const mine = new Promise(resolve => { release = resolve; });
  const tail = prev.then(() => mine);
  orderInitLocks.set(orderId, tail);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (orderInitLocks.get(orderId) === tail) {
      orderInitLocks.delete(orderId);
    }
  }
}

// Reuse a recent open transaction or create a new one.
// No DB connection or transaction is held while calling Paystack's HTTP API:
//   1. Quick read against `pool` to reuse an existing recent pending row.
//   2. External HTTP call to Paystack with zero DB connections checked out.
//   3. Short DB transaction with pg_advisory_xact_lock to re-check & INSERT.
async function getOrCreateTransaction({ orderId, order, email, metadata }) {
  const amountPesewas = toPesewas(order);
  let reuseColumns = await hasReuseColumns(pool);

  if (reuseColumns) {
    try {
      const existing = await findReusableTransaction(pool, orderId, amountPesewas);
      if (existing) {
        logger.info('Paystack init: reusing open transaction', {
          orderId, reference: existing.paystack_reference,
        });
        return {
          authorization_url: existing.authorization_url,
          access_code:       existing.access_code,
          reference:         existing.paystack_reference,
        };
      }
    } catch (err) {
      if (err.code === '42703') {
        _resetReuseColumnCache();
        reuseColumns = false;
      } else {
        throw err;
      }
    }
  }

  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
  const callbackUrl = `${frontendUrl}/payment/callback`;
  const response = await paystackAPI.post('/transaction/initialize', {
    email,
    amount:       amountPesewas, // pesewas
    currency:     'GHS',
    callback_url: callbackUrl,
    metadata,
  });
  const tx = response.data.data;

  // Short DB transaction strictly for persisting the new row (and reconciling
  // any rare cross-process race via pg_advisory_xact_lock).
  const client = await pool.connect();
  let txOpen = false;
  try {
    await client.query('BEGIN');
    txOpen = true;
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`paystack_init:${orderId}`]);

    if (reuseColumns) {
      const raced = await findReusableTransaction(client, orderId, amountPesewas);
      if (raced) {
        await client.query('COMMIT');
        txOpen = false;
        logger.warn('Paystack init: reusing transaction created by concurrent process; discarding duplicate reference', {
          orderId,
          reference: raced.paystack_reference,
          discardedReference: tx.reference,
        });
        return {
          authorization_url: raced.authorization_url,
          access_code:       raced.access_code,
          reference:         raced.paystack_reference,
        };
      }

      await client.query(
        `INSERT INTO payments (id, order_id, amount, status, paystack_reference, customer_email, payment_method,
                               authorization_url, access_code, currency)
         VALUES ($1,$2,$3,'pending',$4,$5,'paystack',$6,$7,'GHS')
         ON CONFLICT (paystack_reference) DO NOTHING`,
        [uuid(), orderId, order.total_amount, tx.reference, email, tx.authorization_url, tx.access_code || null]
      );
    } else {
      await client.query(
        `INSERT INTO payments (id, order_id, amount, status, paystack_reference, customer_email, payment_method)
         VALUES ($1,$2,$3,'pending',$4,$5,'paystack')
         ON CONFLICT (paystack_reference) DO NOTHING`,
        [uuid(), orderId, order.total_amount, tx.reference, email]
      );
    }

    await client.query('COMMIT');
    txOpen = false;
  } catch (err) {
    if (err.code === '42703') _resetReuseColumnCache();
    throw err;
  } finally {
    if (txOpen) await client.query('ROLLBACK').catch(() => {});
    client.release();
  }

  return {
    authorization_url: tx.authorization_url,
    access_code:       tx.access_code,
    reference:         tx.reference,
  };
}

// ── Initialize payment (authenticated user) ───────────────────────────────────
const initializePayment = async (req, res) => {
  try {
    const { orderId } = req.body;
    if (typeof orderId !== 'string' || !UUID_RE.test(orderId)) {
      return res.status(400).json({ error: 'Invalid orderId' });
    }

    const result = await withOrderInitLock(orderId, async () => {
      // Load the order inside the per-order lock so we see the latest state.
      const order = await OrderModel.findById(orderId, req.user.id);
      if (!order) return { status: 404, body: { error: 'Order not found' } };

      const initError = getInitError(order);
      if (initError) return { status: initError.status, body: { error: initError.error } };

      const tx = await getOrCreateTransaction({
        orderId,
        order,
        email:    req.user.email,
        metadata: { orderId, userId: req.user.id },
      });
      return { status: 200, body: tx };
    });

    if (result.status !== 200) return res.status(result.status).json(result.body);
    res.json(result.body);
  } catch (error) {
    logger.error('Paystack init error', { err: error.response?.data?.message || error.message });
    res.status(500).json({ error: 'Failed to initialize payment' });
  }
};

// ── Initialize payment (guest checkout) ──────────────────────────────────────
const initializeGuestPayment = async (req, res) => {
  try {
    const { orderId, email } = req.body;
    if (
      typeof orderId !== 'string' ||
      !UUID_RE.test(orderId) ||
      typeof email !== 'string' ||
      !email.trim()
    ) {
      return res.status(400).json({ error: 'Valid orderId and email are required' });
    }

    const result = await withOrderInitLock(orderId, async () => {
      const order = await OrderModel.findById(orderId);

      // Return a single generic 404 across missing, non-guest, and email-mismatch
      // cases so this endpoint cannot be used as an order existence/ownership oracle.
      if (
        !order ||
        (order.customer_id !== null && order.customer_id !== undefined) ||
        !order.guest_email ||
        order.guest_email.toLowerCase() !== email.trim().toLowerCase()
      ) {
        return { status: 404, body: { error: 'Order not found' } };
      }

      const initError = getInitError(order);
      if (initError) return { status: initError.status, body: { error: initError.error } };

      const tx = await getOrCreateTransaction({
        orderId,
        order,
        email:    order.guest_email,
        metadata: { orderId, guest: true },
      });
      return { status: 200, body: tx };
    });

    if (result.status !== 200) return res.status(result.status).json(result.body);
    res.json(result.body);
  } catch (error) {
    logger.error('Paystack guest init error', { err: error.response?.data?.message || error.message });
    res.status(500).json({ error: 'Failed to initialize payment' });
  }
};

// ── Verify payment (frontend callback) ───────────────────────────────────────
// Called by the frontend after Paystack redirects back.
//
// Requires a locally initiated `payments` row — never authorizes from client-
// controlled metadata alone. Non-final Paystack states return 202 {status:'pending'}
// without overwriting `payments.status`. Only real failures mark pending rows failed.
const verifyPayment = async (req, res) => {
  try {
    const { reference } = req.body;
    if (!reference || typeof reference !== 'string' || !PAYSTACK_REF_RE.test(reference)) {
      return res.status(400).json({ error: 'Invalid payment reference' });
    }

    const { rows: paymentRows } = await pool.query(
      'SELECT order_id, status FROM payments WHERE paystack_reference = $1',
      [reference]
    );
    const orderId = paymentRows[0]?.order_id || null;

    if (!orderId) {
      logger.warn('verifyPayment: unknown payment reference (no payments row)', { reference });
      return res.status(400).json({ error: 'Unknown payment reference' });
    }

    let response;
    try {
      response = await paystackAPI.get(`/transaction/verify/${encodeURIComponent(reference)}`);
    } catch (apiErr) {
      if (apiErr.response?.status === 404) {
        return res.status(400).json({ error: 'Payment reference not found' });
      }
      throw apiErr;
    }

    const txData = response.data?.data;
    if (!response.data?.status || !txData) {
      return res.status(400).json({ error: 'Payment verification failed' });
    }
    if (txData.reference !== reference) {
      logger.error('verifyPayment: response reference mismatch', {
        requested: reference, returned: txData.reference,
      });
      return res.status(400).json({ error: 'Payment reference mismatch' });
    }

    if (NON_FINAL_TX_STATUSES.has(txData.status)) {
      return res.status(202).json({ status: 'pending' });
    }

    if (FAILED_TX_STATUSES.has(txData.status)) {
      await pool.query(
        `UPDATE payments SET status='failed', updated_at=NOW() WHERE paystack_reference=$1 AND status='pending'`,
        [reference]
      );
      return res.status(400).json({ error: 'Payment failed or was reversed' });
    }

    if (txData.status !== 'success') {
      return res.status(400).json({ error: 'Payment not completed' });
    }

    // Defense-in-depth cross-check when metadata carries an orderId
    let metadata = txData.metadata;
    if (typeof metadata === 'string') { try { metadata = JSON.parse(metadata); } catch { metadata = {}; } }
    metadata = (metadata && typeof metadata === 'object') ? metadata : {};
    const metadataOrderId = metadata.orderId || metadata.order_id || null;

    if (metadataOrderId && String(orderId) !== String(metadataOrderId)) {
      logger.error('verifyPayment: payment reference order mismatch', {
        reference, orderId, metadataOrderId,
      });
      return res.status(400).json({ error: 'Payment reference does not match the order' });
    }

    const paidPesewas = Number(txData.amount);
    const paidAmount  = Number.isFinite(paidPesewas) ? paidPesewas / 100 : 0;
    const currency    = txData.currency;

    // Synchronously validate amount/currency and update state under a row lock.
    const client = await pool.connect();
    let mismatchError = null;
    let lockedOrder = null;
    let responseStatus = 'success';
    let enqueuePaymentSuccess = false;
    let postCommitAlert = null;

    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        `SELECT id, status, payment_status, payment_reference, total_amount, customer_id, order_number, refund_status
           FROM orders WHERE id = $1 FOR UPDATE`,
        [orderId]
      );
      const order = rows[0];

      if (!order) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Order not found' });
      }
      lockedOrder = order;

      const expectedPesewas = Math.round(parseFloat(order.total_amount) * 100);

      const { rows: lockedPayRows } = await client.query(
        `SELECT status FROM payments WHERE paystack_reference = $1 FOR UPDATE`,
        [reference]
      );
      const currentPaymentStatus = lockedPayRows[0]?.status;

      if (['refunded', 'needs_review', 'duplicate'].includes(currentPaymentStatus)) {
        await client.query('COMMIT');
        responseStatus = 'attention';
      } else if (currentPaymentStatus === 'success') {
        await client.query('COMMIT');
        if (
          TERMINAL_ORDER_STATUSES.has(order.status) ||
          ['payment_review', 'refunded'].includes(order.payment_status)
        ) {
          responseStatus = 'attention';
        } else {
          responseStatus = 'success';
          enqueuePaymentSuccess = true;
        }
      } else if (TERMINAL_ORDER_STATUSES.has(order.status)) {
        const note = `Paystack payment received for ${order.status} order (ref ${reference}, GHS ${paidAmount.toFixed(2)}) — flagged for payment_review.`;
        await client.query(
          `UPDATE orders SET payment_status = 'payment_review', updated_at = NOW() WHERE id = $1`,
          [orderId]
        );
        await client.query(
          `UPDATE payments SET status = 'needs_review', amount = $2, updated_at = NOW()
            WHERE paystack_reference = $1 AND status = 'pending'`,
          [reference, paidAmount]
        );
        await logStatusChange(orderId, order.status, order.status, note, client);
        await client.query('COMMIT');

        logger.error('verifyPayment: payment received on terminal order — flagged for payment_review', {
          orderId, orderStatus: order.status, reference, paidAmount,
        });
        postCommitAlert = {
          orderId,
          alertKey: `terminal_payment_${reference}`,
          title: `Payment received on ${order.status} order`,
          detail: note,
        };
        responseStatus = 'attention';
      } else if (order.payment_status === 'paid') {
        const { rows: existingRows } = await client.query(
          `SELECT paystack_reference FROM payments WHERE order_id = $1 AND status = 'success' LIMIT 1`,
          [orderId]
        );
        const winningRef = existingRows[0]?.paystack_reference || order.payment_reference;

        if (winningRef && winningRef !== reference) {
          const note = `Duplicate Paystack payment detected (ref ${reference}, GHS ${paidAmount.toFixed(2)}) — order already paid via ${winningRef}. Admin refund required.`;
          await client.query(
            `UPDATE payments SET status = 'duplicate', amount = $2, updated_at = NOW()
              WHERE paystack_reference = $1 AND status != 'duplicate'`,
            [reference, paidAmount]
          );
          await logStatusChange(orderId, order.status, order.status, note, client);
          await client.query('COMMIT');

          logger.error('verifyPayment: duplicate payment detected', {
            orderId, reference, winningRef, paidAmount,
          });
          postCommitAlert = {
            orderId,
            alertKey: `duplicate_payment_${reference}`,
            title: 'Duplicate payment detected',
            detail: note,
          };
          responseStatus = 'attention';
        } else {
          await client.query('COMMIT');
          responseStatus = 'success';
          enqueuePaymentSuccess = true;
        }
      } else if (['payment_review', 'refunded'].includes(order.payment_status)) {
        const note = `Paystack payment received for order already in payment_status="${order.payment_status}" (ref ${reference}, GHS ${paidAmount.toFixed(2)}) — flagged for payment_review.`;
        await client.query(
          `UPDATE payments SET status = 'needs_review', amount = $2, updated_at = NOW()
            WHERE paystack_reference = $1 AND status = 'pending'`,
          [reference, paidAmount]
        );
        await logStatusChange(orderId, order.status, order.status, note, client);
        await client.query('COMMIT');

        logger.error('verifyPayment: payment received on payment_review/refunded order', {
          orderId, paymentStatus: order.payment_status, reference, paidAmount,
        });
        postCommitAlert = {
          orderId,
          alertKey: `review_order_payment_${reference}`,
          title: `Payment received on ${order.payment_status} order`,
          detail: note,
        };
        responseStatus = 'attention';
      } else if (currency !== 'GHS' || !Number.isFinite(paidPesewas) || paidPesewas < expectedPesewas) {
        const reason = `Payment verification mismatch (ref ${reference}): expected ${expectedPesewas} GHS pesewas, got ${paidPesewas} ${currency || 'UNKNOWN'}`;
        await client.query(
          `UPDATE orders SET payment_status = 'payment_review', updated_at = NOW() WHERE id = $1`,
          [orderId]
        );
        await client.query(
          `UPDATE payments SET status = 'needs_review', amount = $2, updated_at = NOW()
            WHERE paystack_reference = $1 AND status = 'pending'`,
          [reference, paidAmount]
        );
        await logStatusChange(orderId, order.status, order.status, reason, client);
        await client.query('COMMIT');
        logger.error('verifyPayment: amount or currency mismatch', {
          orderId, reference, expectedPesewas, paidPesewas, currency,
        });
        mismatchError = 'Payment amount or currency does not match the order';
      } else {
        const needsAdvance = order.status === 'pending';
        const isOverpaid   = paidPesewas > expectedPesewas;
        const diffPesewas  = paidPesewas - expectedPesewas;

        await client.query(
          needsAdvance
            ? `UPDATE orders SET payment_status = 'paid', status = 'confirmed', payment_reference = COALESCE(payment_reference, $2), updated_at = NOW() WHERE id = $1`
            : `UPDATE orders SET payment_status = 'paid', payment_reference = COALESCE(payment_reference, $2), updated_at = NOW() WHERE id = $1`,
          [orderId, reference]
        );
        await client.query(
          `UPDATE payments SET status = 'success', amount = $2, updated_at = NOW() WHERE paystack_reference = $1`,
          [reference, paidAmount]
        );
        if (needsAdvance) {
          await logStatusChange(orderId, order.status, 'confirmed', 'Payment confirmed via Paystack', client);
        }
        if (isOverpaid) {
          const note = `Overpayment flagged for review (ref ${reference}): paid ${paidPesewas} pesewas vs expected ${expectedPesewas} pesewas (+${(diffPesewas / 100).toFixed(2)} GHS)`;
          await logStatusChange(orderId, needsAdvance ? 'confirmed' : order.status, needsAdvance ? 'confirmed' : order.status, note, client);
          logger.warn('verifyPayment: overpayment accepted and flagged for review', {
            orderId, reference, expectedPesewas, paidPesewas, diffPesewas,
          });
        }
        if (order.customer_id) {
          await client.query(
            `UPDATE customers SET total_spent = COALESCE(total_spent, 0) + $1, total_orders = COALESCE(total_orders, 0) + 1 WHERE user_id = $2`,
            [paidAmount, order.customer_id]
          );
        }
        await client.query('COMMIT');
        responseStatus = 'success';
        enqueuePaymentSuccess = true;
      }
    } catch (dbErr) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error('verifyPayment: sync order update failed', { err: dbErr.message, orderId });
      throw dbErr;
    } finally {
      client.release();
    }

    if (mismatchError) {
      return res.status(400).json({ error: mismatchError });
    }

    if (postCommitAlert) {
      const { notificationQueue } = require('../queues');
      notificationQueue.add('admin-payment-alert', postCommitAlert)
        .catch(err => logger.error('Failed to enqueue admin payment alert', { err: err.message, orderId }));
    }

    if (enqueuePaymentSuccess) {
      // Enqueue for downstream work (shipment record, notification emails).
      // Worker's "already paid" branch handles duplicates safely.
      const { paymentQueue } = require('../queues');
      await paymentQueue.add(
        'payment.success',
        { reference, orderId, amount: paidAmount, amountPesewas: paidPesewas, currency },
        { attempts: 3, backoff: { type: 'exponential', delay: 2000 } }
      );
      logger.info('Payment verified and order confirmed', { reference, orderId });
    }

    const isAuthorizedOwner = Boolean(
      req.user &&
      (req.user.role === 'admin' ||
        (lockedOrder?.customer_id && String(lockedOrder.customer_id) === String(req.user.id)))
    );

    if (!isAuthorizedOwner) {
      return res.json({ status: responseStatus });
    }

    // Read order AFTER the synchronous update so the response reflects the
    // current state (confirmed/paid/payment_review) for the verified owner/admin.
    const order = await OrderModel.findById(orderId);
    res.json({
      status:        responseStatus,
      orderId,
      orderNumber:   order?.order_number  || null,
      order_status:  order?.status        || null,
      refund_status: order?.refund_status || null,
    });

  } catch (error) {
    logger.error('Payment verification error', {
      status: error.response?.status,
      err: error.response?.data?.message || error.message,
    });
    res.status(500).json({ error: 'Failed to verify payment' });
  }
};

// ── Refund payload helpers ─────────────────────────────────────────────────────

function getRefundPayloadKey(event) {
  const data = event.data || {};
  return data.id ||
    data.refund_id ||
    data.refund_reference ||
    data.reference ||
    data.transaction_reference ||
    data.transaction?.reference ||
    data.transaction;
}

function getRefundEventId(event) {
  const key = getRefundPayloadKey(event) || 'unknown';
  const status = event.data?.status || 'unknown';
  return `paystack_${event.event}_${key}_${status}`;
}

function getRefundProviderId(data) {
  if (!data) return null;
  return data.id || data.refund_id || null;
}

function getRefundReference(data) {
  if (!data) return null;
  return data.refund_reference || data.reference || null;
}

function getTransactionReference(data) {
  if (!data) return null;
  return data.transaction_reference ||
    data.transaction?.reference ||
    (typeof data.transaction === 'string' ? data.transaction : null);
}

function getRefundFailureDetail(data) {
  if (!data) return 'Paystack refund failed';
  return data.reason ||
    data.message ||
    data.gateway_response ||
    data.status ||
    'Paystack refund failed';
}

async function findRefundOrderForUpdate(client, data) {
  const providerId = getRefundProviderId(data);
  const refundReference = getRefundReference(data);
  const transactionReference = getTransactionReference(data);

  const { rows } = await client.query(
    `SELECT o.*
       FROM orders o
      WHERE ($1::text IS NOT NULL AND o.refund_provider_id = $1)
         OR ($2::text IS NOT NULL AND o.refund_reference = $2)
         OR (
              $3::text IS NOT NULL
              AND (
                o.payment_reference = $3
                OR EXISTS (
                  SELECT 1
                    FROM payments p
                   WHERE p.order_id = o.id
                     AND p.paystack_reference = $3
                )
              )
            )
      ORDER BY
        CASE
          WHEN $1::text IS NOT NULL AND o.refund_provider_id = $1 THEN 1
          WHEN $2::text IS NOT NULL AND o.refund_reference = $2 THEN 2
          ELSE 3
        END,
        o.updated_at DESC
      LIMIT 1
      FOR UPDATE OF o`,
    [providerId ? String(providerId) : null, refundReference, transactionReference]
  );

  return rows[0] || null;
}

// ── Internal: atomically claim an event inside an open transaction ────────────
// Inserts into processed_events. Returns true when this process owns the event
// (first to commit), false when it was already committed by an earlier delivery.
// Because the INSERT is inside the caller's transaction, a concurrent process
// holding BEGIN with the same eventId will block here until the first process
// commits (conflict → returns false) or rolls back (INSERT succeeds → returns true).
async function claimEvent(client, eventId, eventType) {
  const { rowCount } = await client.query(
    'INSERT INTO processed_events (event_id, event_type) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [eventId, eventType]
  );
  return rowCount > 0;
}

// ── charge.success ─────────────────────────────────────────────────────────────
// Resolves the orderId, claims the event inside a transaction, and enqueues the
// payment.success job. Throws on any failure so the caller returns 500 and
// Paystack retries the webhook.
async function processChargeSuccess(event) {
  const txData = event.data;
  let metadata = txData.metadata;
  if (typeof metadata === 'string') { try { metadata = JSON.parse(metadata); } catch { metadata = {}; } }
  metadata = (metadata && typeof metadata === 'object') ? metadata : {};

  const metadataOrderId = metadata.orderId || metadata.order_id || null;
  const { rows: paymentRows } = await pool.query(
    'SELECT order_id FROM payments WHERE paystack_reference = $1',
    [txData.reference]
  );
  const dbOrderId = paymentRows[0]?.order_id || null;

  if (!dbOrderId) {
    logger.warn('Webhook: ignoring charge.success for unknown reference (no payments row)', {
      reference: txData.reference,
    });
    return;
  }

  if (metadataOrderId && String(dbOrderId) !== String(metadataOrderId)) {
    logger.error('Webhook: payment reference order mismatch for charge.success', {
      reference: txData.reference, dbOrderId, metadataOrderId,
    });
    return;
  }

  const orderId = dbOrderId;

  const eventId = `paystack_charge_success_${txData.reference}`;
  const amountPesewas = Number(txData.amount);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const claimed = await claimEvent(client, eventId, event.event);
    if (!claimed) {
      await client.query('COMMIT');
      logger.info('Duplicate charge.success webhook skipped', { eventId });
      return;
    }

    // Enqueue the payment job. pg-boss writes to its own postgres table on a
    // separate connection. If this throws, the ROLLBACK below unclicks the claim
    // in processed_events so Paystack can retry and re-enqueue.
    const { paymentQueue } = require('../queues');
    await paymentQueue.add(
      'payment.success',
      {
        reference: txData.reference,
        orderId,
        amount: amountPesewas / 100,
        amountPesewas,
        currency: txData.currency,
      },
      { attempts: 5, backoff: { type: 'exponential', delay: 3000 } }
    );

    await client.query('COMMIT');
    logger.info('Webhook: charge.success queued', { reference: txData.reference, orderId });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── 3-Tier Refund Webhook Precedence Helpers ──────────────────────────────────
// Precedence: 1. return_requests (partial/item returns)
//             2. payments (status = 'refund_pending', duplicate-payment refunds)
//             3. orders (full order refund)
async function findReturnRequestForWebhook(client, data) {
  const providerId = getRefundProviderId(data);
  const refundRef = getRefundReference(data);
  const txRef = getTransactionReference(data);
  const merchantNote = typeof data?.merchant_note === 'string' ? data.merchant_note : '';
  const amountPesewas = Number.isFinite(Number(data?.amount)) ? Math.round(Number(data.amount)) : null;

  if (providerId) {
    const { rows } = await client.query(
      `SELECT * FROM return_requests WHERE refund_provider_id = $1 LIMIT 1 FOR UPDATE`,
      [String(providerId)]
    );
    if (rows.length > 0) return { match: rows[0], ambiguous: false, candidates: [] };
  }
  if (refundRef) {
    const { rows } = await client.query(
      `SELECT * FROM return_requests WHERE refund_reference = $1 LIMIT 1 FOR UPDATE`,
      [refundRef]
    );
    if (rows.length > 0) return { match: rows[0], ambiguous: false, candidates: [] };
  }
  const noteMatch = merchantNote.match(/\bRET-[0-9A-F]{12}-\d+\b/i);
  if (noteMatch) {
    const { rows } = await client.query(
      `SELECT * FROM return_requests WHERE UPPER(refund_reference) = UPPER($1) LIMIT 1 FOR UPDATE`,
      [noteMatch[0]]
    );
    if (rows.length > 0) return { match: rows[0], ambiguous: false, candidates: [] };
  }

  // Fallback when neither providerId nor merchant_note matched:
  // Match by transaction reference + exact pesewa amount, ONLY if unambiguous (exactly 1 candidate).
  // If >1 refund_pending rows match, flag ambiguous and alert admin instead of auto-resolving.
  if (txRef && amountPesewas !== null && amountPesewas > 0) {
    const { rows } = await client.query(
      `SELECT rr.*
         FROM return_requests rr
         JOIN orders o ON o.id = rr.order_id
        WHERE rr.status = 'refund_pending'
          AND ROUND(rr.refund_amount * 100)::int = $2
          AND (
            o.payment_reference = $1
            OR EXISTS (
              SELECT 1 FROM payments p
               WHERE p.order_id = o.id
                 AND p.paystack_reference = $1
                 AND p.status IN ('success', 'needs_review')
            )
          )
        FOR UPDATE OF rr`,
      [txRef, amountPesewas]
    );
    if (rows.length === 1) return { match: rows[0], ambiguous: false, candidates: [] };
    if (rows.length > 1) return { match: null, ambiguous: true, candidates: rows };
  }

  return { match: null, ambiguous: false, candidates: [] };
}

async function findDuplicatePaymentRefundForWebhook(client, data) {
  const txRef = getTransactionReference(data);
  if (!txRef) return null;
  const { rows } = await client.query(
    `SELECT p.*, o.status AS order_status
       FROM payments p
       JOIN orders o ON o.id = p.order_id
      WHERE p.paystack_reference = $1
        AND p.status = 'refund_pending'
      LIMIT 1
      FOR UPDATE OF p`,
    [txRef]
  );
  return rows[0] || null;
}

// ── refund.processed ───────────────────────────────────────────────────────────
// Applies the refund to the order inside a single transaction that also claims
// the event. Throws on failure so the caller can return 500 for Paystack retry.
async function completePaystackRefundFromWebhook(event) {
  const eventId = getRefundEventId(event);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Claim the event atomically. Concurrent duplicates block here until the
    // first transaction commits (conflict → skip) or rolls back (→ they proceed).
    const claimed = await claimEvent(client, eventId, event.event);
    if (!claimed) {
      await client.query('COMMIT');
      logger.info('Duplicate Paystack refund webhook skipped', { eventId, event: event.event });
      return;
    }

    // Tier 1: Item-level return_requests (provider_id / merchant_note / unambiguous tx+amount)
    const { match: matchedReturn, ambiguous: ambiguousReturn, candidates: ambiguousCandidates } =
      await findReturnRequestForWebhook(client, event.data || {});
    if (ambiguousReturn) {
      const orderId = ambiguousCandidates[0]?.order_id || null;
      const candidateIds = ambiguousCandidates.map(c => c.id.slice(0, 8)).join(', ');
      await client.query('COMMIT');
      logger.error('Ambiguous partial return refund webhook — manual review required', {
        eventId, orderId, candidateCount: ambiguousCandidates.length,
      });
      const { notificationQueue } = require('../queues');
      const alertKey = `ambiguous_return_refund_${eventId}`;
      notificationQueue.add(
        'admin-payment-alert',
        {
          orderId,
          alertKey,
          title: 'Ambiguous partial return refund webhook',
          detail: `Webhook ${event.event} matched ${ambiguousCandidates.length} equal-amount refund_pending returns (${candidateIds}) without a unique reference or merchant_note. None were auto-resolved; please reconcile manually.`,
        },
        { singletonKey: alertKey }
      ).catch(() => {});
      return;
    }
    if (matchedReturn) {
      if (matchedReturn.status !== 'refunded') {
        const { finalizeReturnRequestRefund } = require('./return.controller');
        await finalizeReturnRequestRefund(client, matchedReturn, {
          providerId: getRefundProviderId(event.data),
          refundReference: getRefundReference(event.data),
          notePrefix: 'Paystack partial return refund processed via webhook',
        });
      }
      await client.query('COMMIT');
      const { notificationQueue } = require('../queues');
      notificationQueue.add(
        'return-refunded',
        { orderId: matchedReturn.order_id, returnId: matchedReturn.id },
        { singletonKey: `return_refunded_${matchedReturn.id}` }
      ).catch(() => {});
      logger.info('Paystack refund webhook matched return_request (Tier 1)', { eventId, returnId: matchedReturn.id });
      return;
    }

    // Tier 2: Duplicate-payment refund (payments.status = 'refund_pending')
    const matchedDupPayment = await findDuplicatePaymentRefundForWebhook(client, event.data || {});
    if (matchedDupPayment) {
      const providerId = getRefundProviderId(event.data);
      const amountNum = Number(matchedDupPayment.amount) || 0;
      await client.query(
        `UPDATE payments SET status = 'refunded', updated_at = NOW() WHERE id = $1`,
        [matchedDupPayment.id]
      );
      await logStatusChange(
        matchedDupPayment.order_id,
        matchedDupPayment.order_status,
        matchedDupPayment.order_status,
        `Duplicate payment refund processed via webhook (ref ${matchedDupPayment.paystack_reference}, ${matchedDupPayment.currency || 'GHS'} ${amountNum.toFixed(2)}, Paystack refund #${providerId || 'n/a'})`,
        client
      );
      await client.query('COMMIT');
      logger.info('Paystack refund webhook matched duplicate payment (Tier 2)', { eventId, paymentId: matchedDupPayment.id });
      return;
    }

    // Tier 3: Full order refund
    const order = await findRefundOrderForUpdate(client, event.data || {});
    if (!order) {
      await client.query('COMMIT');
      logger.warn('Paystack refund webhook could not be matched to an order', {
        event: event.event,
        refundProviderId: getRefundProviderId(event.data),
        refundReference: getRefundReference(event.data),
        transactionReference: getTransactionReference(event.data),
      });
      return;
    }

    // success is terminal — never overwrite it.
    if (order.refund_status === 'success') {
      await client.query('COMMIT');
      logger.info('Paystack refund webhook already applied', { eventId, orderId: order.id });
      return;
    }

    const providerId = getRefundProviderId(event.data);
    const refundReference = getRefundReference(event.data);

    // If the refund was not initiated from the app ('pending' / 'needs_attention'),
    // flag payment_review and alert admin instead of dropping the event.
    if (!['pending', 'needs_attention'].includes(order.refund_status)) {
      const note = `External Paystack refund processed (ref ${refundReference || providerId || 'n/a'}) while refund_status="${order.refund_status}" — flagged for payment_review.`;
      const refundNotes = [order.refund_notes, note].filter(Boolean).join('\n');

      await client.query(
        `UPDATE orders
            SET payment_status = 'payment_review',
                refund_provider_id = COALESCE(refund_provider_id, $1),
                refund_reference = COALESCE(refund_reference, $2),
                refund_notes = $3,
                updated_at = NOW()
          WHERE id = $4`,
        [providerId ? String(providerId) : null, refundReference, refundNotes, order.id]
      );

      await logStatusChange(order.id, order.status, order.status, note, client);
      await client.query('COMMIT');

      logger.warn('External Paystack refund processed — flagged for payment_review', {
        eventId, orderId: order.id, previousRefundStatus: order.refund_status,
      });

      const { notificationQueue } = require('../queues');
      notificationQueue.add('admin-payment-alert', {
        orderId: order.id,
        alertKey: eventId,
        title: 'External Paystack refund processed',
        detail: note,
      }).catch(err => logger.error('Failed to enqueue external refund alert', { err: err.message, orderId: order.id }));
      return;
    }

    await client.query(
      `UPDATE orders
          SET refund_status = 'success',
              status = 'refunded',
              payment_status = 'refunded',
              refund_provider_id = COALESCE(refund_provider_id, $1),
              refund_reference = COALESCE(refund_reference, $2),
              refunded_at = NOW(),
              updated_at = NOW()
        WHERE id = $3`,
      [providerId ? String(providerId) : null, refundReference, order.id]
    );

    await client.query(
      `UPDATE payments
          SET status = 'refunded',
              updated_at = NOW()
        WHERE order_id = $1
          AND status IN ('success', 'needs_review')`,
      [order.id]
    );

    await logStatusChange(
      order.id,
      order.status,
      'refunded',
      'Paystack refund processed',
      client
    );

    await client.query('COMMIT');
    logger.info('Paystack refund marked successful', { eventId, orderId: order.id });

    const { notificationQueue } = require('../queues');
    notificationQueue.add('order-refunded', { orderId: order.id })
      .catch(err => logger.error('Failed to enqueue refund notification from webhook', { err: err.message, orderId: order.id }));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── refund.failed ──────────────────────────────────────────────────────────────
// Records the refund failure inside a transaction that also claims the event.
// success is terminal — a refund.failed arriving after refund.processed is a no-op.
async function failPaystackRefundFromWebhook(event) {
  const eventId = getRefundEventId(event);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const claimed = await claimEvent(client, eventId, event.event);
    if (!claimed) {
      await client.query('COMMIT');
      logger.info('Duplicate Paystack refund webhook skipped', { eventId, event: event.event });
      return;
    }

    // Tier 1: Item-level return_requests
    const { match: matchedReturn, ambiguous: ambiguousReturn, candidates: ambiguousCandidates } =
      await findReturnRequestForWebhook(client, event.data || {});
    if (ambiguousReturn) {
      const orderId = ambiguousCandidates[0]?.order_id || null;
      await client.query('COMMIT');
      const { notificationQueue } = require('../queues');
      const alertKey = `ambiguous_return_refund_fail_${eventId}`;
      notificationQueue.add(
        'admin-payment-alert',
        {
          orderId,
          alertKey,
          title: 'Ambiguous partial return refund failure webhook',
          detail: `Webhook ${event.event} matched ${ambiguousCandidates.length} equal-amount refund_pending returns without a unique identifier. Please inspect manually.`,
        },
        { singletonKey: alertKey }
      ).catch(() => {});
      return;
    }
    if (matchedReturn) {
      if (matchedReturn.status === 'refund_pending') {
        const detail = getRefundFailureDetail(event.data);
        await client.query(
          `UPDATE return_requests
              SET status = 'refund_failed',
                  refund_provider_id = COALESCE(refund_provider_id, $1),
                  admin_note = COALESCE(admin_note || E'\n', '') || $2,
                  updated_at = NOW()
            WHERE id = $3`,
          [getRefundProviderId(event.data) ? String(getRefundProviderId(event.data)) : null, `Paystack refund failed: ${detail}`, matchedReturn.id]
        );
        const { rows: [ord] } = await client.query('SELECT status FROM orders WHERE id = $1', [matchedReturn.order_id]);
        if (ord) {
          await logStatusChange(
            matchedReturn.order_id,
            ord.status,
            ord.status,
            `Partial return refund failed on Paystack (return ${matchedReturn.id.slice(0, 8)}): ${detail}`,
            client
          );
        }
      }
      await client.query('COMMIT');
      logger.warn('Paystack refund.failed matched return_request (Tier 1)', { eventId, returnId: matchedReturn.id });
      return;
    }

    // Tier 2: Duplicate-payment refund (payments.status = 'refund_pending')
    const matchedDupPayment = await findDuplicatePaymentRefundForWebhook(client, event.data || {});
    if (matchedDupPayment) {
      const detail = getRefundFailureDetail(event.data);
      await client.query(
        `UPDATE payments SET status = 'duplicate', updated_at = NOW() WHERE id = $1`,
        [matchedDupPayment.id]
      );
      await logStatusChange(
        matchedDupPayment.order_id,
        matchedDupPayment.order_status,
        matchedDupPayment.order_status,
        `Duplicate payment refund failed via webhook (ref ${matchedDupPayment.paystack_reference}): ${detail} — reverted to duplicate`,
        client
      );
      await client.query('COMMIT');
      const { notificationQueue } = require('../queues');
      notificationQueue.add('admin-payment-alert', {
        orderId: matchedDupPayment.order_id,
        alertKey: eventId,
        title: 'Duplicate payment refund failed',
        detail: `Duplicate payment ${matchedDupPayment.paystack_reference} refund failed (${detail}) and was reverted to duplicate.`,
      }).catch(() => {});
      return;
    }

    // Tier 3: Full order refund
    const order = await findRefundOrderForUpdate(client, event.data || {});
    if (!order) {
      await client.query('COMMIT');
      logger.warn('Paystack refund failure webhook could not be matched to an order', {
        event: event.event,
        refundProviderId: getRefundProviderId(event.data),
        refundReference: getRefundReference(event.data),
        transactionReference: getTransactionReference(event.data),
      });
      return;
    }

    // Never downgrade a successful refund.
    if (order.refund_status === 'success') {
      await client.query('COMMIT');
      logger.warn('Paystack refund failure ignored — refund already succeeded', {
        eventId, orderId: order.id,
      });
      return;
    }

    // Only set 'failed' from 'pending' or 'needs_attention'.
    if (!['pending', 'needs_attention'].includes(order.refund_status)) {
      await client.query('COMMIT');
      logger.warn('Paystack refund failure ignored for non-pending order', {
        eventId, orderId: order.id, refundStatus: order.refund_status,
      });
      return;
    }

    const providerId = getRefundProviderId(event.data);
    const refundReference = getRefundReference(event.data);
    const failureDetail = getRefundFailureDetail(event.data);
    const refundNotes = [order.refund_notes, `Paystack refund failed: ${failureDetail}`]
      .filter(Boolean)
      .join('\n');

    await client.query(
      `UPDATE orders
          SET refund_status = 'failed',
              refund_provider_id = COALESCE(refund_provider_id, $1),
              refund_reference = COALESCE(refund_reference, $2),
              refund_notes = $3,
              updated_at = NOW()
        WHERE id = $4`,
      [providerId ? String(providerId) : null, refundReference, refundNotes, order.id]
    );

    await client.query('COMMIT');
    logger.warn('Paystack refund marked failed', {
      eventId, orderId: order.id, detail: failureDetail,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── refund.needs-attention ─────────────────────────────────────────────────────
async function handleRefundNeedsAttentionFromWebhook(event) {
  const eventId = getRefundEventId(event);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const claimed = await claimEvent(client, eventId, event.event);
    if (!claimed) {
      await client.query('COMMIT');
      logger.info('Duplicate Paystack refund.needs-attention webhook skipped', { eventId });
      return;
    }

    // Tier 1: Item-level return_requests
    const { match: matchedReturn, ambiguous: ambiguousReturn, candidates: ambiguousCandidates } =
      await findReturnRequestForWebhook(client, event.data || {});
    if (ambiguousReturn) {
      const orderId = ambiguousCandidates[0]?.order_id || null;
      await client.query('COMMIT');
      const { notificationQueue } = require('../queues');
      const alertKey = `ambiguous_return_refund_attn_${eventId}`;
      notificationQueue.add(
        'admin-payment-alert',
        {
          orderId,
          alertKey,
          title: 'Ambiguous partial return needs-attention webhook',
          detail: `Webhook ${event.event} matched ${ambiguousCandidates.length} equal-amount refund_pending returns without a unique identifier. Please inspect manually.`,
        },
        { singletonKey: alertKey }
      ).catch(() => {});
      return;
    }
    if (matchedReturn) {
      const detail = getRefundFailureDetail(event.data);
      const { rows: [ord] } = await client.query('SELECT status FROM orders WHERE id = $1', [matchedReturn.order_id]);
      if (ord) {
        await logStatusChange(
          matchedReturn.order_id,
          ord.status,
          ord.status,
          `Partial return refund needs attention (return ${matchedReturn.id.slice(0, 8)}): ${detail}`,
          client
        );
      }
      await client.query('COMMIT');
      const { notificationQueue } = require('../queues');
      notificationQueue.add('admin-payment-alert', {
        orderId: matchedReturn.order_id,
        alertKey: eventId,
        title: 'Partial return refund needs attention',
        detail: `Return ${matchedReturn.id.slice(0, 8)} requires customer account details (${detail}).`,
      }).catch(() => {});
      return;
    }

    // Tier 2: Duplicate-payment refund
    const matchedDupPayment = await findDuplicatePaymentRefundForWebhook(client, event.data || {});
    if (matchedDupPayment) {
      const detail = getRefundFailureDetail(event.data);
      await client.query('COMMIT');
      const { notificationQueue } = require('../queues');
      notificationQueue.add('admin-payment-alert', {
        orderId: matchedDupPayment.order_id,
        alertKey: eventId,
        title: 'Duplicate payment refund needs attention',
        detail: `Duplicate payment ${matchedDupPayment.paystack_reference} refund needs attention (${detail}).`,
      }).catch(() => {});
      return;
    }

    // Tier 3: Full order refund
    const order = await findRefundOrderForUpdate(client, event.data || {});
    if (!order) {
      await client.query('COMMIT');
      logger.warn('Paystack refund.needs-attention webhook could not be matched to an order', {
        refundProviderId: getRefundProviderId(event.data),
        refundReference: getRefundReference(event.data),
        transactionReference: getTransactionReference(event.data),
      });
      return;
    }

    if (order.refund_status === 'success') {
      await client.query('COMMIT');
      logger.info('Paystack refund.needs-attention ignored — refund already succeeded', {
        eventId, orderId: order.id,
      });
      return;
    }

    const providerId = getRefundProviderId(event.data);
    const refundReference = getRefundReference(event.data);
    const detail = getRefundFailureDetail(event.data);
    const note = `Paystack refund needs attention — customer account details required (${detail})`;
    const refundNotes = [order.refund_notes, note].filter(Boolean).join('\n');

    await client.query(
      `UPDATE orders
          SET refund_status = 'needs_attention',
              refund_method = COALESCE(refund_method, 'paystack'),
              refund_provider_id = COALESCE(refund_provider_id, $1),
              refund_reference = COALESCE(refund_reference, $2),
              refund_notes = $3,
              updated_at = NOW()
        WHERE id = $4`,
      [providerId ? String(providerId) : null, refundReference, refundNotes, order.id]
    );

    await logStatusChange(
      order.id,
      order.status,
      order.status,
      'Paystack refund needs attention — customer account details required',
      client
    );

    await client.query('COMMIT');
    logger.warn('Paystack refund marked needs_attention', {
      eventId, orderId: order.id, providerId, detail,
    });

    const { notificationQueue } = require('../queues');
    notificationQueue.add('admin-payment-alert', {
      orderId: order.id,
      alertKey: eventId,
      title: 'Paystack refund needs attention',
      detail: note,
    }).catch(err => logger.error('Failed to enqueue refund needs-attention alert', { err: err.message, orderId: order.id }));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── charge.dispute.* ───────────────────────────────────────────────────────────
async function handleDisputeWebhook(event) {
  const data = event.data || {};
  const disputeKey = data.id || data.transaction?.reference || data.transaction_reference || 'unknown';
  const eventId = `paystack_${event.event}_${disputeKey}_${data.status || 'na'}`;
  const txRef = getTransactionReference(data);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const claimed = await claimEvent(client, eventId, event.event);
    if (!claimed) {
      await client.query('COMMIT');
      logger.info('Duplicate Paystack dispute webhook skipped', { eventId, event: event.event });
      return;
    }

    let order = null;
    if (txRef) {
      const { rows } = await client.query(
        `SELECT o.*
           FROM orders o
          WHERE o.payment_reference = $1
             OR EXISTS (
                  SELECT 1 FROM payments p
                   WHERE p.order_id = o.id
                     AND p.paystack_reference = $1
                )
          ORDER BY o.updated_at DESC
          LIMIT 1
          FOR UPDATE OF o`,
        [txRef]
      );
      order = rows[0] || null;
    }

    if (!order) {
      await client.query('COMMIT');
      logger.warn('Paystack dispute webhook could not be matched to an order', {
        event: event.event, disputeId: data.id, transactionReference: txRef,
      });
      return;
    }

    const reason = data.category || data.reason || data.status || 'dispute update';
    const note = `Paystack dispute event ${event.event} (dispute ${data.id || 'n/a'}, status ${data.status || 'n/a'}): ${reason}`;

    await client.query(
      `UPDATE orders
          SET payment_status = CASE WHEN payment_status = 'refunded' THEN 'refunded' ELSE 'payment_review' END,
              updated_at = NOW()
        WHERE id = $1`,
      [order.id]
    );

    await logStatusChange(order.id, order.status, order.status, note, client);
    await client.query('COMMIT');

    logger.warn('Paystack dispute flagged order for payment_review', {
      eventId, event: event.event, orderId: order.id, disputeId: data.id,
    });

    const { notificationQueue } = require('../queues');
    notificationQueue.add('admin-payment-alert', {
      orderId: order.id,
      alertKey: eventId,
      title: `Paystack ${event.event}`,
      detail: note,
    }).catch(err => logger.error('Failed to enqueue dispute alert', { err: err.message, orderId: order.id }));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── Paystack webhook ──────────────────────────────────────────────────────────
// Flow: verify signature → process event durably → return 200.
// Any processing failure returns 500 so Paystack retries. The 200 is only sent
// after all durable DB and queue work has committed.
const handleWebhook = async (req, res) => {
  try {
    if (!Buffer.isBuffer(req.rawBody)) {
      logger.warn('Webhook rejected: missing or non-JSON raw body');
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    const signature = req.headers['x-paystack-signature'];
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!signature || typeof signature !== 'string' || !secretKey) {
      logger.warn('Webhook rejected: missing signature or key');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const expectedHex = crypto
      .createHmac('sha512', secretKey)
      .update(req.rawBody)
      .digest('hex');

    const expectedBuf = Buffer.from(expectedHex, 'hex');
    const providedBuf = /^[0-9a-f]+$/i.test(signature) ? Buffer.from(signature, 'hex') : null;

    if (!providedBuf || providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
      logger.warn('Webhook rejected: invalid signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const event = req.body;
    if (!event || typeof event !== 'object') {
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    if (REFUND_SUCCESS_EVENTS.has(event.event)) {
      await completePaystackRefundFromWebhook(event);
    } else if (REFUND_FAILED_EVENTS.has(event.event)) {
      await failPaystackRefundFromWebhook(event);
    } else if (event.event === 'refund.needs-attention') {
      await handleRefundNeedsAttentionFromWebhook(event);
    } else if (REFUND_STATUS_EVENTS.has(event.event)) {
      // Informational only — no durable state change needed.
      logger.info('Paystack refund status webhook received', {
        event: event.event,
        refundReference: getRefundReference(event.data),
        transactionReference: getTransactionReference(event.data),
      });
    } else if (DISPUTE_EVENTS.has(event.event)) {
      await handleDisputeWebhook(event);
    } else if (event.event === 'charge.success') {
      await processChargeSuccess(event);
    }

    // 200 is sent only after all durable work has committed.
    res.status(200).send('OK');
  } catch (err) {
    // Return 500 so Paystack retries the webhook. Do not send 200 on error.
    logger.error('Webhook processing failed', { err: err.message, event: req.body?.event });
    res.status(500).json({ error: 'Processing failed' });
  }
};

// ── Native Mobile Money Charge API (MTN / Telecel / AT Money) ────────────────
const VALID_MOMO_PROVIDERS = new Set(['mtn', 'vod', 'atl']);

function normalizeGhanaMomoPhone(raw) {
  if (typeof raw !== 'string') return null;
  let cleaned = raw.replace(/[\s\-().]/g, '');
  if (cleaned.startsWith('+233')) cleaned = '0' + cleaned.slice(4);
  else if (cleaned.startsWith('233') && cleaned.length === 12) cleaned = '0' + cleaned.slice(3);
  if (!/^0[235]\d{8}$/.test(cleaned)) return null;
  return cleaned;
}

const chargeMobileMoney = async (req, res) => {
  try {
    const { orderId, phone, provider, email } = req.body || {};
    if (typeof orderId !== 'string' || !UUID_RE.test(orderId)) {
      return res.status(400).json({ error: 'Invalid orderId' });
    }
    const normProvider = typeof provider === 'string' ? provider.trim().toLowerCase() : '';
    if (!VALID_MOMO_PROVIDERS.has(normProvider)) {
      return res.status(400).json({ error: 'Unsupported Mobile Money network. Choose MTN, Telecel, or AT Money.' });
    }
    const normPhone = normalizeGhanaMomoPhone(phone);
    if (!normPhone) {
      return res.status(400).json({ error: 'Enter a valid 10-digit Ghana Mobile Money number (e.g. 024XXXXXXX or 055XXXXXXX).' });
    }

    const result = await withOrderInitLock(orderId, async () => {
      let order;
      let payerEmail;
      let metadata;

      if (req.user) {
        order = await OrderModel.findById(orderId, req.user.id);
        if (!order) return { status: 404, body: { error: 'Order not found' } };
        payerEmail = req.user.email;
        metadata = { orderId, userId: req.user.id, channel: 'mobile_money_direct', provider: normProvider };
      } else {
        if (typeof email !== 'string' || !email.trim()) {
          return { status: 400, body: { error: 'Email is required for guest payment' } };
        }
        order = await OrderModel.findById(orderId);
        if (
          !order ||
          order.user_id !== null ||
          !order.guest_email ||
          order.guest_email.trim().toLowerCase() !== email.trim().toLowerCase()
        ) {
          return { status: 404, body: { error: 'Order not found' } };
        }
        payerEmail = order.guest_email.trim().toLowerCase();
        metadata = { orderId, guest: true, channel: 'mobile_money_direct', provider: normProvider };
      }

      const initError = getInitError(order);
      if (initError) return { status: initError.status, body: { error: initError.error } };

      const amountPesewas = toPesewas(order);
      const response = await paystackAPI.post('/charge', {
        email: payerEmail,
        amount: amountPesewas,
        currency: 'GHS',
        mobile_money: {
          phone: normPhone,
          provider: normProvider,
        },
        metadata,
      });

      const tx = response.data?.data || {};
      const reference = tx.reference;
      if (!reference) {
        return { status: 502, body: { error: 'Paystack did not return a payment reference.' } };
      }

      const reuseColumns = await hasReuseColumns(pool);
      const client = await pool.connect();
      let txOpen = false;
      try {
        await client.query('BEGIN');
        txOpen = true;
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`paystack_init:${orderId}`]);
        if (reuseColumns) {
          await client.query(
            `INSERT INTO payments (id, order_id, amount, status, paystack_reference, customer_email, payment_method, currency)
             VALUES ($1,$2,$3,'pending',$4,$5,'paystack','GHS')
             ON CONFLICT (paystack_reference) DO NOTHING`,
            [uuid(), orderId, order.total_amount, reference, payerEmail]
          );
        } else {
          await client.query(
            `INSERT INTO payments (id, order_id, amount, status, paystack_reference, customer_email, payment_method)
             VALUES ($1,$2,$3,'pending',$4,$5,'paystack')
             ON CONFLICT (paystack_reference) DO NOTHING`,
            [uuid(), orderId, order.total_amount, reference, payerEmail]
          );
        }
        await client.query('COMMIT');
        txOpen = false;
      } finally {
        if (txOpen) await client.query('ROLLBACK').catch(() => {});
        client.release();
      }

      logger.info('Paystack direct MoMo charge initiated', {
        orderId,
        reference,
        provider: normProvider,
        chargeStatus: tx.status,
      });

      return {
        status: 200,
        body: {
          reference,
          status: tx.status || 'pay_offline',
          display_text: tx.display_text || response.data?.message || '',
          message: response.data?.message || 'Charge initiated',
        },
      };
    });

    if (result.status !== 200) return res.status(result.status).json(result.body);
    res.json(result.body);
  } catch (error) {
    const paystackMsg = error.response?.data?.message || error.response?.data?.data?.message;
    const httpCode = error.response?.status;
    logger.error('Paystack direct MoMo charge error', { err: paystackMsg || error.message });
    if (httpCode && httpCode >= 400 && httpCode < 500 && paystackMsg) {
      return res.status(400).json({ error: paystackMsg });
    }
    res.status(500).json({ error: paystackMsg || 'Failed to initiate Mobile Money payment' });
  }
};

const submitMobileMoneyOtp = async (req, res) => {
  try {
    const { reference, otp, email } = req.body || {};
    if (typeof reference !== 'string' || !PAYSTACK_REF_RE.test(reference.trim())) {
      return res.status(400).json({ error: 'Invalid payment reference' });
    }
    const cleanOtp = typeof otp === 'string' ? otp.trim() : '';
    if (!/^[A-Za-z0-9]{4,10}$/.test(cleanOtp)) {
      return res.status(400).json({ error: 'Enter the verification OTP sent to your phone.' });
    }

    const { rows } = await pool.query(
      `SELECT p.order_id, o.customer_id, o.guest_email
         FROM payments p
         JOIN orders o ON o.id = p.order_id
        WHERE p.paystack_reference = $1
        LIMIT 1`,
      [reference.trim()]
    );
    const rec = rows[0];
    if (!rec) {
      return res.status(404).json({ error: 'Payment reference not found' });
    }

    // Enforce order ownership so callers cannot interact with another user's pending charge
    if (req.user) {
      if (rec.customer_id !== req.user.id) {
        return res.status(404).json({ error: 'Payment reference not found' });
      }
    } else {
      if (rec.customer_id !== null) {
        return res.status(404).json({ error: 'Payment reference not found' });
      }
      if (
        typeof email === 'string' &&
        email.trim() &&
        (!rec.guest_email || rec.guest_email.trim().toLowerCase() !== email.trim().toLowerCase())
      ) {
        return res.status(404).json({ error: 'Payment reference not found' });
      }
    }

    const response = await paystackAPI.post('/charge/submit_otp', {
      reference: reference.trim(),
      otp: cleanOtp,
    });
    const tx = response.data?.data || {};
    res.json({
      reference: tx.reference || reference.trim(),
      status: tx.status || 'pay_offline',
      display_text: tx.display_text || response.data?.message || '',
      message: response.data?.message || 'OTP submitted',
    });
  } catch (error) {
    const paystackMsg = error.response?.data?.message || error.response?.data?.data?.message;
    const httpCode = error.response?.status;
    logger.error('Paystack submit_otp error', { err: paystackMsg || error.message });
    if (httpCode && httpCode >= 400 && httpCode < 500 && paystackMsg) {
      return res.status(400).json({ error: paystackMsg });
    }
    res.status(500).json({ error: paystackMsg || 'Failed to submit OTP' });
  }
};

module.exports = {
  initializePayment,
  initializeGuestPayment,
  chargeMobileMoney,
  submitMobileMoneyOtp,
  verifyPayment,
  handleWebhook,
  _resetReuseColumnCache,
  _withOrderInitLock: withOrderInitLock,
  _orderInitLockCount: () => orderInitLocks.size,
};

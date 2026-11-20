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
async function hasReuseColumns(client) {
  const now = Date.now();
  if (reuseColumnCache.present === true) return true;
  if (reuseColumnCache.present === false && now - reuseColumnCache.checkedAt < REUSE_COLUMN_NEGATIVE_TTL_MS) {
    return false;
  }
  const { rows } = await client.query(
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

// Reuse a recent open transaction or create a new one. Caller holds the per-order
// advisory lock inside an open transaction on `client`.
async function getOrCreateTransaction(client, { orderId, order, email, metadata }) {
  const amountPesewas = toPesewas(order);
  const reuseColumns = await hasReuseColumns(client);

  if (reuseColumns) {
    const existing = await findReusableTransaction(client, orderId, amountPesewas);
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

  if (reuseColumns) {
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

  return {
    authorization_url: tx.authorization_url,
    access_code:       tx.access_code,
    reference:         tx.reference,
  };
}

// Serialise init calls per order so two simultaneous requests cannot both create
// a reference. An advisory lock (not a row lock) is used on purpose: the lock is
// held across the Paystack HTTP call, and a row lock on `orders` would block
// webhook/admin updates to that order for that long.
async function lockOrderForInit(client, orderId) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`paystack_init:${orderId}`]);
}

// ── Initialize payment (authenticated user) ───────────────────────────────────
const initializePayment = async (req, res) => {
  let client = null;
  let txOpen = false;
  try {
    const { orderId } = req.body;
    if (typeof orderId !== 'string' || !UUID_RE.test(orderId)) {
      return res.status(400).json({ error: 'Invalid orderId' });
    }

    client = await pool.connect();
    await client.query('BEGIN');
    txOpen = true;
    await lockOrderForInit(client, orderId);

    // Load the order only after taking the lock so we see the latest state.
    const order = await OrderModel.findById(orderId, req.user.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const initError = getInitError(order);
    if (initError) return res.status(initError.status).json({ error: initError.error });

    const tx = await getOrCreateTransaction(client, {
      orderId,
      order,
      email:    req.user.email,
      metadata: { orderId, userId: req.user.id },
    });

    await client.query('COMMIT');
    txOpen = false;
    res.json(tx);
  } catch (error) {
    logger.error('Paystack init error', { err: error.response?.data?.message || error.message });
    res.status(500).json({ error: 'Failed to initialize payment' });
  } finally {
    if (client) {
      if (txOpen) await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  }
};

// ── Initialize payment (guest checkout) ──────────────────────────────────────
const initializeGuestPayment = async (req, res) => {
  let client = null;
  let txOpen = false;
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

    client = await pool.connect();
    await client.query('BEGIN');
    txOpen = true;
    await lockOrderForInit(client, orderId);

    const order = await OrderModel.findById(orderId);

    // Return a single generic 404 across missing, non-guest, and email-mismatch
    // cases so this endpoint cannot be used as an order existence/ownership oracle.
    if (
      !order ||
      (order.customer_id !== null && order.customer_id !== undefined) ||
      !order.guest_email ||
      order.guest_email.toLowerCase() !== email.trim().toLowerCase()
    ) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const initError = getInitError(order);
    if (initError) return res.status(initError.status).json({ error: initError.error });

    const tx = await getOrCreateTransaction(client, {
      orderId,
      order,
      email:    order.guest_email,
      metadata: { orderId, guest: true },
    });

    await client.query('COMMIT');
    txOpen = false;
    res.json(tx);
  } catch (error) {
    logger.error('Paystack guest init error', { err: error.response?.data?.message || error.message });
    res.status(500).json({ error: 'Failed to initialize payment' });
  } finally {
    if (client) {
      if (txOpen) await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
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

module.exports = { initializePayment, initializeGuestPayment, verifyPayment, handleWebhook, _resetReuseColumnCache };

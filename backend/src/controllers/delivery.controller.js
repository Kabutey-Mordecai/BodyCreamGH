'use strict';

const crypto        = require('crypto');
const jwt           = require('jsonwebtoken');
const pool          = require('../config/database');
const DeliveryModel = require('../models/delivery.model');
const OrderModel    = require('../models/order.model');
const notify        = require('../services/notification.service');
const emailService  = require('../services/email.service');
const { sendShippingNotification } = emailService;
const { logStatusChange, logAdminAction } = require('../utils/audit');
const { ADMIN_ROLES } = require('../middleware/auth');
const { notificationQueue } = require('../queues');
const logger        = require('../utils/logger');

const VALID_DELIVERY_STATUSES = ['pending', 'in_transit', 'out_for_delivery', 'delivered'];
const MAX_POD_OTP_ATTEMPTS = 5;

/**
 * Maps Ghanaian region/city to a short Jumia-style routing zone code
 * printed prominently on the shipping label and embedded in the barcode.
 */
function resolveGhanaZone(region, city) {
  const hay = `${region || ''} ${city || ''}`.toLowerCase();
  if (hay.includes('accra') || hay.includes('tema') || hay.includes('legon') || hay.includes('madina')) return 'ACC';
  if (hay.includes('ashanti') || hay.includes('kumasi')) return 'KSI';
  if (hay.includes('western') || hay.includes('takoradi') || hay.includes('sekondi')) return 'TAK';
  if (hay.includes('central') || hay.includes('cape coast') || hay.includes('kasoa')) return 'CAP';
  if (hay.includes('northern') || hay.includes('tamale')) return 'TAM';
  if (hay.includes('eastern') || hay.includes('koforidua')) return 'KOF';
  if (hay.includes('volta') || hay.includes('ho')) return 'VOL';
  if (hay.includes('bono') || hay.includes('sunyani')) return 'SUN';
  return 'GHA';
}

/**
 * Generates a Jumia-style structured parcel barcode pattern:
 *   BC-<ZONE>-<9DIGITS>-<4CHECKSUM>   e.g. BC-ACC-308721487-6357
 */
function generateTrackingNumber(zoneCode = 'ACC') {
  const num9 = String(crypto.randomInt(100000000, 1000000000));
  const check4 = String(crypto.randomInt(1000, 10000));
  return `BC-${zoneCode}-${num9}-${check4}`;
}

function hashPodOtp(otp) {
  const secret = process.env.OTP_HMAC_SECRET || process.env.JWT_SECRET;
  return crypto.createHmac('sha256', secret).update(`pod:${String(otp).trim()}`).digest('hex');
}

function verifyPodOtp(submitted, storedHash) {
  if (!storedHash || typeof storedHash !== 'string' || !/^[0-9a-f]{64}$/i.test(storedHash)) {
    return false;
  }
  const a = Buffer.from(hashPodOtp(submitted), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function signRiderToken(deliveryId, trackingNumber) {
  return jwt.sign(
    { sub: deliveryId, tn: trackingNumber, purpose: 'rider_pod' },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '72h' }
  );
}

function verifyRiderToken(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') {
    const err = new Error('Missing rider handoff token');
    err.status = 401;
    throw err;
  }
  try {
    const payload = jwt.verify(rawToken, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (payload?.purpose !== 'rider_pod' || !payload?.sub) {
      throw new Error('Invalid token purpose');
    }
    return payload;
  } catch {
    const err = new Error('Invalid or expired rider handoff link');
    err.status = 401;
    throw err;
  }
}

// Middleware for signed rider photo upload
function requireRiderToken(req, res, next) {
  try {
    const token = req.query.token || req.headers['x-rider-token'] || req.body?.token;
    req.rider = verifyRiderToken(token);
    next();
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message });
  }
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

    const zoneCode = resolveGhanaZone(order.shipping_region, order.shipping_city);
    const providedTracking = typeof tracking_number === 'string' ? tracking_number.trim() : '';
    const finalTracking = providedTracking || generateTrackingNumber(zoneCode);
    const finalPartner = (typeof delivery_partner === 'string' && delivery_partner.trim())
      ? delivery_partner.trim()
      : 'In-house Dispatch Bike';

    const deliveryId = await DeliveryModel.create({
      orderId:          order_id,
      deliveryPartner:  finalPartner,
      trackingNumber:   finalTracking,
      estimatedDelivery: estimated_delivery,
      driverPhone:      driver_phone,
      zoneCode,
    });

    // Mark order as shipped and log the change
    const prevStatus = order.status;
    await OrderModel.updateStatus(order_id, 'shipped');
    await logStatusChange(order_id, prevStatus, 'shipped', `Dispatch created (${finalPartner} · Zone ${zoneCode}). Tracking: ${finalTracking}`);

    // Notify customer
    const emailAddress = order.email || order.user_email || order.guest_email;
    if (emailAddress) {
      sendShippingNotification(emailAddress, {
        orderNumber:     order.order_number,
        trackingNumber:  finalTracking,
        deliveryPartner: finalPartner,
      }).catch(err => logger.error('sendShippingNotification error', { err: err.message }));
    }

    notify.shipmentCreated({ orderNumber: order.order_number, trackingNumber: finalTracking, orderId: order_id });

    res.status(201).json({
      deliveryId,
      trackingNumber: finalTracking,
      zoneCode,
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
      zone_code:          d.zone_code,
      status:             d.status,
      delivery_partner:   d.delivery_partner,
      estimated_delivery: d.estimated_delivery,
      actual_delivery:    d.actual_delivery_date,
      pod_verified_at:    d.pod_verified_at,
      pod_verified_method: d.pod_verified_method,
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

    if (!ADMIN_ROLES.has(req.user.role)) {
      const order = await OrderModel.findById(orderId, req.user.id);
      if (!order) return res.status(404).json({ error: 'Order not found' });
    }

    const delivery = await DeliveryModel.findByOrderId(orderId);
    if (!delivery) return res.status(404).json({ error: 'No delivery record found for this order' });

    // Never expose pod_otp_hash over the API
    const { pod_otp_hash, ...safeDelivery } = delivery;
    res.json({ ...safeDelivery, has_pod_otp: Boolean(pod_otp_hash) });
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

// ── Admin: generate & send 6-digit Proof-of-Delivery OTP + signed Rider Link ──
const sendPodOtp = async (req, res) => {
  try {
    const { deliveryId } = req.params;
    const { rows } = await pool.query(
      `SELECT d.*, o.order_number, o.customer_id, o.total_amount, o.payment_method, o.payment_status,
              o.guest_email, o.guest_phone, o.shipping_city, o.shipping_region,
              u.email AS user_email, u.first_name, u.phone AS user_phone
         FROM deliveries d
         JOIN orders o ON o.id = d.order_id
         LEFT JOIN users u ON u.id = o.customer_id
        WHERE d.id = $1`,
      [deliveryId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Delivery not found' });

    const d = rows[0];
    if (d.pod_verified_at) {
      return res.status(409).json({ error: 'Delivery has already been verified' });
    }

    const otp = String(crypto.randomInt(100000, 1000000));
    const otpHash = hashPodOtp(otp);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    const zoneCode = d.zone_code || resolveGhanaZone(d.shipping_region, d.shipping_city);

    await pool.query(
      `UPDATE deliveries
          SET pod_otp_hash = $1,
              pod_otp_expires_at = $2,
              pod_otp_attempts = 0,
              zone_code = COALESCE(zone_code, $3),
              updated_at = NOW()
        WHERE id = $4`,
      [otpHash, expiresAt, zoneCode, deliveryId]
    );

    const riderToken = signRiderToken(d.id, d.tracking_number);
    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    const riderUrl = `${frontendUrl}/rider-handoff?token=${encodeURIComponent(riderToken)}`;

    // Dispatch 6-digit OTP to customer via SMS, Email, and Push
    const phone = d.user_phone || d.guest_phone;
    const email = d.user_email || d.guest_email;

    if (phone) {
      notify.sendSms({
        to: phone,
        message: `BodyCream GH: Your delivery verification code for order #${d.order_number} is ${otp}. Share this ONLY with the rider face-to-face after inspecting your parcel.`,
      }).catch(err => logger.warn('POD OTP SMS failed', { err: err.message }));
    }

    if (email && typeof emailService.sendOtpEmail === 'function') {
      emailService.sendOtpEmail(email, {
        firstName: d.first_name || 'Valued Customer',
        otp,
      }).catch(err => logger.warn('POD OTP email failed', { err: err.message }));
    }

    if (d.customer_id) {
      notify.sendPushNotification({
        userId: d.customer_id,
        title: `Delivery Code: ${otp}`,
        body: `Share code ${otp} with your rider ONLY after receiving order #${d.order_number}.`,
        data: { order_number: d.order_number, type: 'pod_otp' },
      }).catch(() => {});
    }

    logAdminAction({
      actorId: req.user?.id,
      actorEmail: req.userEmail,
      action: 'delivery.pod_otp_sent',
      resourceType: 'delivery',
      resourceId: d.id,
      details: { order_number: d.order_number, tracking_number: d.tracking_number },
      ip: req.ip,
    }).catch(() => {});

    const response = {
      message: 'Delivery OTP sent to customer & Rider Handoff link generated',
      rider_url: riderUrl,
      tracking_number: d.tracking_number,
      zone_code: zoneCode,
      expires_at: expiresAt.toISOString(),
    };
    // On non-production demos without live SMS credentials, surface the demo OTP so buyers can test end-to-end
    if (process.env.NODE_ENV !== 'production' && !process.env.SMS_API_KEY) {
      response.demo_otp = otp;
    }

    res.json(response);
  } catch (err) {
    logger.error('sendPodOtp error', { err: err.message });
    res.status(500).json({ error: 'Failed to generate delivery OTP' });
  }
};

// ── Rider (signed token): view safe handoff details ───────────────────────────
const getRiderHandoff = async (req, res) => {
  try {
    const payload = verifyRiderToken(req.query.token || req.headers['x-rider-token']);
    const { rows } = await pool.query(
      `SELECT d.id, d.order_id, d.status, d.tracking_number, d.zone_code, d.delivery_partner,
              d.pod_verified_at, d.pod_verified_method, d.pod_photo_url, d.pod_otp_attempts,
              o.order_number, o.total_amount, o.payment_method, o.payment_status,
              o.shipping_address, o.shipping_city, o.shipping_region,
              COALESCE(u.first_name, o.guest_first_name, 'Customer') AS recipient_first_name,
              (SELECT COALESCE(SUM(quantity), 0)::int FROM order_items WHERE order_id = o.id) AS item_count
         FROM deliveries d
         JOIN orders o ON o.id = d.order_id
         LEFT JOIN users u ON u.id = o.customer_id
        WHERE d.id = $1`,
      [payload.sub]
    );
    if (!rows.length) return res.status(404).json({ error: 'Delivery not found' });

    const r = rows[0];
    const isCodUnpaid = r.payment_method === 'pay_on_delivery' &&
      !['paid', 'partially_refunded', 'refunded'].includes(r.payment_status);

    res.json({
      delivery_id: r.id,
      order_number: r.order_number,
      tracking_number: r.tracking_number,
      zone_code: r.zone_code || 'GHA',
      delivery_partner: r.delivery_partner,
      status: r.status,
      recipient_first_name: r.recipient_first_name,
      address: [r.shipping_address, r.shipping_city, r.shipping_region].filter(Boolean).join(', '),
      item_count: r.item_count,
      cod_amount_due: isCodUnpaid ? Number(r.total_amount) : 0,
      payment_method: r.payment_method,
      payment_status: r.payment_status,
      already_verified: Boolean(r.pod_verified_at),
      pod_verified_at: r.pod_verified_at,
      pod_photo_url: r.pod_photo_url,
      attempts_remaining: Math.max(0, MAX_POD_OTP_ATTEMPTS - (r.pod_otp_attempts || 0)),
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Failed to load handoff details' });
  }
};

// ── Rider (signed token): verify 6-digit OTP + live photo + GPS + optional COD ──
const confirmRiderDelivery = async (req, res) => {
  const client = await pool.connect();
  let tx = false;
  try {
    const payload = verifyRiderToken(req.body?.token || req.headers['x-rider-token']);
    const {
      otp,
      pod_photo_url,
      lat,
      lng,
      accuracy,
      recipient_name,
      cod_collected,
      collection_method,
      payment_reference,
    } = req.body || {};

    if (!otp || !/^\d{6}$/.test(String(otp).trim())) {
      return res.status(400).json({ error: 'Please enter the customer\'s 6-digit delivery code' });
    }
    if (!pod_photo_url || typeof pod_photo_url !== 'string' || !pod_photo_url.startsWith('/uploads/')) {
      return res.status(400).json({ error: 'Live parcel handoff photo is required for Proof of Delivery' });
    }

    await client.query('BEGIN');
    tx = true;

    const { rows } = await client.query(
      `SELECT d.*, o.order_number, o.status AS order_status, o.total_amount,
              o.payment_method, o.payment_status, o.customer_id, o.guest_email,
              u.email AS user_email
         FROM deliveries d
         JOIN orders o ON o.id = d.order_id
         LEFT JOIN users u ON u.id = o.customer_id
        WHERE d.id = $1
        FOR UPDATE OF d`,
      [payload.sub]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      tx = false;
      return res.status(404).json({ error: 'Delivery not found' });
    }

    const d = rows[0];
    if (d.pod_verified_at) {
      await client.query('ROLLBACK');
      tx = false;
      return res.status(409).json({ error: 'This delivery is already verified' });
    }
    if (!d.pod_otp_hash) {
      await client.query('ROLLBACK');
      tx = false;
      return res.status(400).json({ error: 'No active delivery OTP — ask dispatch to resend the code' });
    }
    if ((d.pod_otp_attempts || 0) >= MAX_POD_OTP_ATTEMPTS) {
      await client.query('ROLLBACK');
      tx = false;
      return res.status(429).json({ error: 'Too many invalid attempts — delivery code locked. Contact dispatch to regenerate.' });
    }
    if (d.pod_otp_expires_at && new Date(d.pod_otp_expires_at) < new Date()) {
      await client.query('ROLLBACK');
      tx = false;
      return res.status(400).json({ error: 'Delivery code expired — ask dispatch to send a fresh code' });
    }

    const isValid = verifyPodOtp(otp, d.pod_otp_hash);
    if (!isValid) {
      const nextAttempts = (d.pod_otp_attempts || 0) + 1;
      await client.query('UPDATE deliveries SET pod_otp_attempts = $1, updated_at = NOW() WHERE id = $2', [nextAttempts, d.id]);
      await client.query('COMMIT');
      tx = false;
      const remaining = Math.max(0, MAX_POD_OTP_ATTEMPTS - nextAttempts);
      return res.status(400).json({
        error: remaining > 0
          ? `Incorrect 6-digit code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
          : 'Too many invalid attempts — code locked. Contact dispatch.',
        attempts_remaining: remaining,
      });
    }

    const numLat = Number.isFinite(Number(lat)) ? Number(lat) : null;
    const numLng = Number.isFinite(Number(lng)) ? Number(lng) : null;
    const numAcc = Number.isFinite(Number(accuracy)) ? Number(accuracy) : null;
    const safeRecipient = typeof recipient_name === 'string' ? recipient_name.trim().slice(0, 120) : null;

    await client.query(
      `UPDATE deliveries
          SET status = 'delivered',
              actual_delivery_date = CURRENT_DATE,
              pod_photo_url = $1,
              pod_lat = $2,
              pod_lng = $3,
              pod_accuracy = $4,
              pod_verified_at = NOW(),
              pod_verified_method = 'rider_otp_photo',
              pod_recipient_name = $5,
              pod_otp_hash = NULL,
              updated_at = NOW()
        WHERE id = $6`,
      [pod_photo_url, numLat, numLng, numAcc, safeRecipient, d.id]
    );

    const isCodUnpaid = d.payment_method === 'pay_on_delivery' &&
      !['paid', 'partially_refunded', 'refunded'].includes(d.payment_status);
    const markCodPaid = isCodUnpaid && cod_collected === true;

    await client.query(
      `UPDATE orders
          SET status = 'delivered',
              delivered_at = COALESCE(delivered_at, NOW()),
              payment_status = CASE WHEN $1 THEN 'paid' ELSE payment_status END,
              updated_at = NOW()
        WHERE id = $2`,
      [markCodPaid, d.order_id]
    );

    if (markCodPaid) {
      const method = ['cash', 'momo', 'bank_transfer'].includes(collection_method) ? collection_method : 'cash';
      const ref = (typeof payment_reference === 'string' && payment_reference.trim())
        ? payment_reference.trim().slice(0, 80)
        : `COD-${d.order_number}-${Date.now().toString(36).toUpperCase()}`;
      await client.query(
        `INSERT INTO payments (order_id, amount, status, payment_method, paystack_reference, customer_email)
         VALUES ($1, $2, 'success', $3, $4, $5)
         ON CONFLICT (paystack_reference) DO NOTHING`,
        [d.order_id, d.total_amount, `cod_${method}`, ref, d.user_email || d.guest_email || null]
      );
    }

    const gpsText = numLat !== null && numLng !== null ? ` · GPS: ${numLat.toFixed(5)}, ${numLng.toFixed(5)}` : '';
    const codText = markCodPaid ? ` · COD Collected (${collection_method || 'cash'})` : '';
    await logStatusChange(
      d.order_id,
      d.order_status,
      'delivered',
      `Verified Delivery (6-digit Customer OTP + Photo${gpsText}${codText}) · Tracking: ${d.tracking_number}`,
      client
    );

    await client.query('COMMIT');
    tx = false;

    notify.shipmentDelivered({ trackingNumber: d.tracking_number, orderNumber: d.order_number });
    res.json({
      message: 'Delivery verified and completed!',
      order_number: d.order_number,
      verified_at: new Date().toISOString(),
      cod_paid: markCodPaid,
    });
  } catch (err) {
    if (tx) await client.query('ROLLBACK').catch(() => {});
    logger.error('confirmRiderDelivery error', { err: err.message });
    res.status(err.status || 500).json({ error: err.message || 'Failed to verify delivery' });
  } finally {
    client.release();
  }
};

// ── Customer (authenticated): self-confirm receipt of shipped order ──────────
const confirmCustomerReceipt = async (req, res) => {
  const client = await pool.connect();
  let tx = false;
  try {
    const { orderId } = req.params;
    const order = await OrderModel.findById(orderId, req.user.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'delivered') {
      return res.json({ message: 'Order is already marked delivered' });
    }
    if (order.status !== 'shipped') {
      return res.status(400).json({ error: 'Only shipped orders can be confirmed as received' });
    }

    await client.query('BEGIN');
    tx = true;

    await client.query(
      `UPDATE orders SET status = 'delivered', delivered_at = COALESCE(delivered_at, NOW()), updated_at = NOW() WHERE id = $1`,
      [orderId]
    );
    await client.query(
      `UPDATE deliveries
          SET status = 'delivered',
              actual_delivery_date = COALESCE(actual_delivery_date, CURRENT_DATE),
              pod_verified_at = COALESCE(pod_verified_at, NOW()),
              pod_verified_method = COALESCE(pod_verified_method, 'customer_confirmed'),
              updated_at = NOW()
        WHERE order_id = $1`,
      [orderId]
    );
    await logStatusChange(orderId, 'shipped', 'delivered', 'Customer confirmed package received in storefront', client);

    await client.query('COMMIT');
    tx = false;

    res.json({ message: 'Thank you! Order confirmed as received.' });
  } catch (err) {
    if (tx) await client.query('ROLLBACK').catch(() => {});
    logger.error('confirmCustomerReceipt error', { err: err.message });
    res.status(500).json({ error: 'Failed to confirm receipt' });
  } finally {
    client.release();
  }
};

module.exports = {
  createDelivery,
  trackShipment,
  getDeliveryByOrder,
  updateDelivery,
  sendPodOtp,
  getRiderHandoff,
  confirmRiderDelivery,
  confirmCustomerReceipt,
  requireRiderToken,
};

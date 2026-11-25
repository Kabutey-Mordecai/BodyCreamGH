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
const VALID_VEHICLE_TYPES = ['motorbike', 'van', 'bicycle', 'car', 'courier'];
const MAX_POD_OTP_ATTEMPTS = 5;

let ridersTablePromise = null;
async function ensureRidersTable() {
  if (!ridersTablePromise) {
    ridersTablePromise = pool
      .query(`
        CREATE TABLE IF NOT EXISTS dispatch_riders (
          id            UUID PRIMARY KEY,
          name          VARCHAR(120) NOT NULL,
          phone         VARCHAR(40),
          phone_norm    VARCHAR(32),
          vehicle_type  VARCHAR(40)  NOT NULL DEFAULT 'motorbike',
          vehicle_plate VARCHAR(40),
          zone_coverage VARCHAR(160),
          notes         TEXT,
          is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
          created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
          updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_dispatch_riders_name_lower
          ON dispatch_riders (LOWER(TRIM(name)));
        CREATE UNIQUE INDEX IF NOT EXISTS idx_dispatch_riders_phone_norm
          ON dispatch_riders (phone_norm)
          WHERE phone_norm IS NOT NULL AND phone_norm <> '';
      `)
      .catch(err => {
        ridersTablePromise = null;
        throw err;
      });
  }
  return ridersTablePromise;
}

/**
 * Normalizes Ghanaian & international mobile numbers to a canonical digit key
 * so duplicate phone numbers (e.g. "024 123 4567" vs "+233241234567") are caught.
 */
function normalizeRiderPhone(raw) {
  if (typeof raw !== 'string') return { clean: null, norm: null };
  const trimmed = raw.trim();
  if (!trimmed) return { clean: null, norm: null };
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return { clean: null, norm: null };
  let norm = digits;
  if (digits.length === 10 && digits.startsWith('0')) {
    norm = `233${digits.slice(1)}`;
  } else if (digits.length === 9) {
    norm = `233${digits}`;
  }
  return { clean: trimmed.slice(0, 40), norm: norm.slice(0, 32) };
}

async function findRegisteredRiderByName(name) {
  if (typeof name !== 'string' || !name.trim()) return null;
  try {
    await ensureRidersTable();
    const { rows } = await pool.query(
      `SELECT id, name, phone, vehicle_type, vehicle_plate, zone_coverage, is_active
         FROM dispatch_riders
        WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
        LIMIT 1`,
      [name.trim()]
    );
    return rows[0] || null;
  } catch {
    return null;
  }
}

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

const MANIFEST_EXPIRY_PRESETS = {
  '24h': '24h',
  '3d':  '3d',
  '7d':  '7d',
  '14d': '14d',
};

function signRiderToken(deliveryId, trackingNumber) {
  return jwt.sign(
    { sub: deliveryId, tn: trackingNumber, purpose: 'rider_pod' },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '14d' }
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

function signRiderManifestToken({ deliveryPartner, driverPhone, expiresIn = '7d' } = {}) {
  const safeExpiry = MANIFEST_EXPIRY_PRESETS[expiresIn] || '7d';
  return jwt.sign(
    {
      purpose: 'rider_manifest',
      dp: deliveryPartner || null,
      ph: driverPhone || null,
    },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: safeExpiry }
  );
}

function verifyRiderManifestToken(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') {
    const err = new Error('Missing rider manifest token');
    err.status = 401;
    throw err;
  }
  try {
    const payload = jwt.verify(rawToken, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (payload?.purpose !== 'rider_manifest') {
      throw new Error('Invalid manifest token');
    }
    return payload;
  } catch {
    const err = new Error('Invalid or expired rider manifest link');
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

async function dispatchOrderWithOtp({
  order,
  deliveryPartner,
  trackingNumber,
  estimatedDelivery,
  driverPhone,
}) {
  const zoneCode = resolveGhanaZone(order.shipping_region, order.shipping_city);
  const providedTracking = typeof trackingNumber === 'string' ? trackingNumber.trim() : '';
  const finalTracking = providedTracking || generateTrackingNumber(zoneCode);
  const rawPartner = (typeof deliveryPartner === 'string' && deliveryPartner.trim())
    ? deliveryPartner.trim()
    : 'In-house Dispatch Bike';

  const matchedRider = await findRegisteredRiderByName(rawPartner);
  const finalPartner = matchedRider?.name || rawPartner;

  const resolvedDriverPhone = (typeof driverPhone === 'string' && driverPhone.trim())
    ? driverPhone.trim()
    : (matchedRider?.phone || null);

  const deliveryId = await DeliveryModel.create({
    orderId:           order.id,
    deliveryPartner:   finalPartner,
    trackingNumber:    finalTracking,
    estimatedDelivery: estimatedDelivery,
    driverPhone:       resolvedDriverPhone,
    zoneCode,
  });

  // Automatically generate & store a 7-day 6-digit Proof-of-Delivery OTP
  const otp = String(crypto.randomInt(100000, 1000000));
  const otpHash = hashPodOtp(otp);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await pool.query(
    `UPDATE deliveries
        SET pod_otp_hash = $1,
            pod_otp_expires_at = $2,
            pod_otp_attempts = 0,
            updated_at = NOW()
      WHERE id = $3`,
    [otpHash, expiresAt, deliveryId]
  );

  // Mark order as shipped and log the change
  const prevStatus = order.status;
  await OrderModel.updateStatus(order.id, 'shipped');
  await logStatusChange(order.id, prevStatus, 'shipped', `Dispatch created (${finalPartner} · Zone ${zoneCode}). Tracking: ${finalTracking}`);

  // Notify customer: Shipping email + automatic 6-digit Delivery Code (Email, SMS, Push)
  const emailAddress = order.email || order.user_email || order.guest_email;
  const phoneAddress = order.phone || order.user_phone || order.guest_phone;
  const firstName = order.first_name || order.guest_first_name || 'Valued Customer';

  if (emailAddress) {
    sendShippingNotification(emailAddress, {
      orderNumber:     order.order_number,
      trackingNumber:  finalTracking,
      deliveryPartner: finalPartner,
    }).catch(err => logger.error('sendShippingNotification error', { err: err.message }));

    const sendDeliveryOtp = emailService.sendDeliveryOtpEmail || emailService.sendOtpEmail;
    if (typeof sendDeliveryOtp === 'function') {
      sendDeliveryOtp(emailAddress, { firstName, otp, orderNumber: order.order_number })
        .catch(err => logger.warn('Auto POD OTP email failed', { err: err.message }));
    }
  }

  if (phoneAddress) {
    notify.sendSms({
      to: phoneAddress,
      message: `BodyCream GH: Order #${order.order_number} (${finalTracking}) is dispatched! Your 6-digit delivery code is ${otp}. Share ONLY with the rider after inspecting your parcel.`,
    }).catch(err => logger.warn('Auto POD OTP SMS failed', { err: err.message }));
  }

  if (order.customer_id) {
    notify.sendPushNotification({
      userId: order.customer_id,
      title: `Dispatched · Code: ${otp}`,
      body: `Order #${order.order_number} is on its way. Share code ${otp} with the rider after inspecting your parcel.`,
      data: { order_number: order.order_number, type: 'pod_otp' },
    }).catch(() => {});
  }

  notify.shipmentCreated({ orderNumber: order.order_number, trackingNumber: finalTracking, orderId: order.id });

  return { deliveryId, trackingNumber: finalTracking, zoneCode, deliveryPartner: finalPartner };
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

    const result = await dispatchOrderWithOtp({
      order,
      deliveryPartner: delivery_partner,
      trackingNumber: tracking_number,
      estimatedDelivery: estimated_delivery,
      driverPhone: driver_phone,
    });

    res.status(201).json({
      ...result,
      message: 'Delivery created, order marked as shipped & 6-digit delivery code sent',
    });
  } catch (error) {
    logger.error('Create delivery error', { err: error.message });
    res.status(500).json({ error: 'Failed to create delivery' });
  }
};

// Admin: bulk dispatch 1..100 selected orders to a rider & return 1 manifest link
const bulkDispatch = async (req, res) => {
  try {
    const { order_ids, delivery_partner, driver_phone, expires_in } = req.body || {};
    if (!Array.isArray(order_ids) || !order_ids.length) {
      return res.status(400).json({ error: 'Select at least 1 order to dispatch' });
    }

    const rawPartner = (typeof delivery_partner === 'string' && delivery_partner.trim())
      ? delivery_partner.trim()
      : 'In-house Dispatch Bike';
    const matchedRider = await findRegisteredRiderByName(rawPartner);
    const cleanPartner = matchedRider?.name || rawPartner;
    const cleanPhone = (typeof driver_phone === 'string' && driver_phone.trim())
      ? driver_phone.trim()
      : (matchedRider?.phone || '');
    const safeExpiry = MANIFEST_EXPIRY_PRESETS[expires_in] || '7d';

    let dispatched = 0;
    let skipped = 0;
    const dispatchedOrders = [];

    for (const orderId of order_ids.slice(0, 100)) {
      const order = await OrderModel.findById(orderId);
      if (!order || ['cancelled', 'refunded', 'delivered'].includes(order.status)) {
        skipped += 1;
        continue;
      }
      const existing = await DeliveryModel.findByOrderId(orderId);
      if (existing) {
        skipped += 1;
        continue;
      }
      const r = await dispatchOrderWithOtp({
        order,
        deliveryPartner: cleanPartner,
        driverPhone: cleanPhone || undefined,
      });
      dispatched += 1;
      dispatchedOrders.push({ order_number: order.order_number, tracking_number: r.trackingNumber });
    }

    const token = signRiderManifestToken({
      deliveryPartner: cleanPartner,
      driverPhone: cleanPhone || null,
      expiresIn: safeExpiry,
    });
    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    const manifestUrl = `${frontendUrl}/rider-manifest?token=${encodeURIComponent(token)}`;

    logAdminAction({
      actorId: req.user?.id,
      actorEmail: req.userEmail,
      action: 'delivery.bulk_dispatch',
      resourceType: 'delivery',
      resourceId: null,
      details: { delivery_partner: cleanPartner, dispatched, skipped },
      ip: req.ip,
    }).catch(() => {});

    res.status(201).json({
      dispatched_count: dispatched,
      skipped_count: skipped,
      delivery_partner: cleanPartner,
      driver_phone: cleanPhone || null,
      expires_in: safeExpiry,
      manifest_url: manifestUrl,
      dispatched_orders: dispatchedOrders,
    });
  } catch (err) {
    logger.error('bulkDispatch error', { err: err.message });
    res.status(500).json({ error: 'Failed to bulk dispatch orders' });
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
      delivery_partner:   d.delivery_partner || 'In-house Dispatch',
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
      'SELECT status, order_id, tracking_number, delivery_partner, driver_phone FROM deliveries WHERE id = $1',
      [deliveryId]
    );
    if (!before.length) return res.status(404).json({ error: 'Delivery not found' });

    const prev = before[0];

    let resolvedPartner = undefined;
    let resolvedPhone = undefined;

    if (delivery_partner !== undefined) {
      const candidatePartner = (typeof delivery_partner === 'string' && delivery_partner.trim())
        ? delivery_partner.trim()
        : 'In-house Dispatch Bike';
      const matched = await findRegisteredRiderByName(candidatePartner);
      resolvedPartner = matched?.name || candidatePartner;

      const partnerChanged =
        String(prev.delivery_partner || '').trim().toLowerCase() !== resolvedPartner.toLowerCase();

      if (typeof driver_phone === 'string' && driver_phone.trim()) {
        resolvedPhone = driver_phone.trim();
      } else if (partnerChanged) {
        // Sync to newly selected rider's registered phone (or clear old rider's phone if unregistered)
        resolvedPhone = matched?.phone || null;
      } else if (driver_phone !== undefined) {
        resolvedPhone = null;
      }
    } else if (driver_phone !== undefined) {
      resolvedPhone = (typeof driver_phone === 'string' && driver_phone.trim())
        ? driver_phone.trim()
        : null;
    }

    await DeliveryModel.update(deliveryId, {
      status,
      trackingNumber:      tracking_number || undefined,
      estimatedDelivery:   estimated_delivery || undefined,
      actualDeliveryDate:  actual_delivery_date || undefined,
      driverPhone:         resolvedPhone,
      deliveryPartner:     resolvedPartner,
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
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days (supports intercity & 3rd-party couriers)
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

    const sendDeliveryOtp = emailService.sendDeliveryOtpEmail || emailService.sendOtpEmail;
    if (email && typeof sendDeliveryOtp === 'function') {
      sendDeliveryOtp(email, {
        firstName: d.first_name || 'Valued Customer',
        otp,
        orderNumber: d.order_number,
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
    const r2Base = (process.env.R2_PUBLIC_BASE_URL || process.env.R2_PUBLIC_URL || '').trim().replace(/\/+$/, '');
    const isValidPhotoUrl = typeof pod_photo_url === 'string' && (
      pod_photo_url.startsWith('/uploads/') ||
      (Boolean(r2Base) && pod_photo_url.startsWith(`${r2Base}/`))
    );
    if (!pod_photo_url || !isValidPhotoUrl) {
      return res.status(400).json({ error: 'Live parcel handoff photo is required for Proof of Delivery' });
    }

    await client.query('BEGIN');
    tx = true;

    const { rows } = await client.query(
      `SELECT d.*, o.order_number, o.status AS order_status, o.total_amount,
              o.payment_method, o.payment_status, o.customer_id, o.guest_email,
              o.guest_phone, o.guest_first_name,
              u.email AS user_email, u.first_name AS user_first_name, u.phone AS user_phone
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

    let finalMethod = null;
    let finalRef = null;
    if (markCodPaid) {
      finalMethod = ['cash', 'momo', 'bank_transfer'].includes(collection_method) ? collection_method : 'cash';
      finalRef = (typeof payment_reference === 'string' && payment_reference.trim())
        ? payment_reference.trim().slice(0, 80)
        : `COD-${d.order_number}-${Date.now().toString(36).toUpperCase()}`;
      await client.query(
        `INSERT INTO payments (order_id, amount, status, payment_method, paystack_reference, customer_email)
         VALUES ($1, $2, 'success', $3, $4, $5)
         ON CONFLICT (paystack_reference) DO NOTHING`,
        [d.order_id, d.total_amount, `cod_${finalMethod}`, finalRef, d.user_email || d.guest_email || null]
      );
    }

    const gpsText = numLat !== null && numLng !== null ? ` · GPS: ${numLat.toFixed(5)}, ${numLng.toFixed(5)}` : '';
    const codText = markCodPaid ? ` · COD Collected (${finalMethod || 'cash'})` : '';
    await logStatusChange(
      d.order_id,
      d.order_status,
      'delivered',
      `Verified Delivery (6-digit Customer OTP + Photo${gpsText}${codText}) · Tracking: ${d.tracking_number}`,
      client
    );

    await client.query('COMMIT');
    tx = false;

    const verifiedAtIso = new Date().toISOString();
    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').toString().split(',')[0].trim();
    const host = req.get('host');
    const absolutePhotoUrl = pod_photo_url.startsWith('http')
      ? pod_photo_url
      : (host ? `${proto}://${host}${pod_photo_url}` : pod_photo_url);

    const customerEmail = d.user_email || d.guest_email || null;
    const customerPhone = d.user_phone || d.guest_phone || null;
    const customerName = d.user_first_name || d.guest_first_name || safeRecipient || 'Valued Customer';

    const receiptPayload = {
      customerName,
      orderNumber: d.order_number,
      trackingNumber: d.tracking_number,
      riderName: d.delivery_partner || 'In-house Dispatch Bike',
      recipientName: safeRecipient || customerName,
      verifiedAt: verifiedAtIso,
      photoUrl: absolutePhotoUrl,
      lat: numLat,
      lng: numLng,
      codPaid: markCodPaid,
      collectionMethod: finalMethod,
      paymentReference: finalRef,
      amount: Number(d.total_amount || 0),
    };

    // 1. Send Proof-of-Delivery verification receipt email to Customer
    if (customerEmail && typeof emailService.sendProofOfDeliveryReceipt === 'function') {
      emailService.sendProofOfDeliveryReceipt(customerEmail, { ...receiptPayload, isAdmin: false })
        .catch(err => logger.warn('Customer POD receipt email failed', { err: err.message }));
    }

    // 2. Send Proof-of-Delivery verification copy to Admin
    if (typeof emailService.sendProofOfDeliveryReceipt === 'function') {
      pool.query(`SELECT setting_value FROM site_settings WHERE setting_key = 'order_notification_email' LIMIT 1`)
        .then(({ rows: sRows }) => {
          const adminEmail = sRows[0]?.setting_value?.trim() || process.env.ADMIN_EMAIL || process.env.SMTP_USER;
          if (adminEmail) {
            return emailService.sendProofOfDeliveryReceipt(adminEmail, { ...receiptPayload, isAdmin: true });
          }
        })
        .catch(err => logger.warn('Admin POD receipt email failed', { err: err.message }));
    }

    // 3. Send SMS confirmation to Customer
    if (customerPhone) {
      notify.sendSms({
        to: customerPhone,
        message: `BodyCream GH: Order #${d.order_number} (${d.tracking_number}) was delivered & verified via 6-digit OTP${markCodPaid ? ` · COD GH₵${Number(d.total_amount).toFixed(2)} received` : ''}. Thank you for shopping with us!`,
      }).catch(err => logger.warn('Customer POD SMS failed', { err: err.message }));
    }

    notify.shipmentDelivered({ trackingNumber: d.tracking_number, orderNumber: d.order_number });
    res.json({
      message: 'Delivery verified and completed!',
      order_number: d.order_number,
      tracking_number: d.tracking_number,
      verified_at: verifiedAtIso,
      cod_paid: markCodPaid,
      collection_method: finalMethod,
      payment_reference: finalRef,
      amount: Number(d.total_amount || 0),
      recipient_name: safeRecipient || customerName,
      rider_name: d.delivery_partner || 'In-house Dispatch Bike',
      lat: numLat,
      lng: numLng,
      photo_url: absolutePhotoUrl,
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

// ── Admin: list active dispatch riders & active in-flight partners ───────────
const getDeliveryPartners = async (_req, res) => {
  try {
    await ensureRidersTable();

    // 1. Registered active riders from dispatch_riders with live workload counts
    const { rows: fleetRows } = await pool.query(
      `SELECT r.id,
              r.name AS delivery_partner,
              r.phone AS driver_phone,
              r.vehicle_type,
              r.vehicle_plate,
              r.zone_coverage,
              TRUE AS is_registered,
              COUNT(d.id) FILTER (
                WHERE d.status IN ('pending', 'in_transit', 'out_for_delivery')
                  AND d.pod_verified_at IS NULL
                  AND o.status NOT IN ('delivered', 'cancelled', 'refunded')
              )::int AS active_count,
              COUNT(d.id)::int AS total_count
         FROM dispatch_riders r
         LEFT JOIN deliveries d ON LOWER(TRIM(d.delivery_partner)) = LOWER(TRIM(r.name))
         LEFT JOIN orders o ON o.id = d.order_id
        WHERE r.is_active = TRUE
        GROUP BY r.id
        ORDER BY active_count DESC, r.name ASC`
    );

    // 2. Include unregistered partners ONLY if they currently have active unverified stops
    //    (prevents historical test names with 0 active stops from cluttering dispatch chips)
    const { rows: activeLegacyRows } = await pool.query(
      `SELECT NULL::uuid AS id,
              TRIM(d.delivery_partner) AS delivery_partner,
              MAX(NULLIF(TRIM(d.driver_phone), '')) AS driver_phone,
              'motorbike'::text AS vehicle_type,
              NULL::text AS vehicle_plate,
              NULL::text AS zone_coverage,
              FALSE AS is_registered,
              COUNT(*) FILTER (
                WHERE d.status IN ('pending', 'in_transit', 'out_for_delivery')
                  AND d.pod_verified_at IS NULL
                  AND o.status NOT IN ('delivered', 'cancelled', 'refunded')
              )::int AS active_count,
              COUNT(*)::int AS total_count
         FROM deliveries d
         JOIN orders o ON o.id = d.order_id
        WHERE d.delivery_partner IS NOT NULL
          AND TRIM(d.delivery_partner) <> ''
          AND NOT EXISTS (
            SELECT 1 FROM dispatch_riders r
             WHERE LOWER(TRIM(r.name)) = LOWER(TRIM(d.delivery_partner))
          )
        GROUP BY TRIM(d.delivery_partner)
       HAVING COUNT(*) FILTER (
                WHERE d.status IN ('pending', 'in_transit', 'out_for_delivery')
                  AND d.pod_verified_at IS NULL
                  AND o.status NOT IN ('delivered', 'cancelled', 'refunded')
              ) > 0
        ORDER BY active_count DESC, TRIM(d.delivery_partner) ASC`
    );

    res.json({ partners: [...fleetRows, ...activeLegacyRows] });
  } catch (err) {
    logger.error('getDeliveryPartners error', { err: err.message });
    res.status(500).json({ error: 'Failed to load delivery partners' });
  }
};

// ── Admin: Full Fleet & Riders Management CRUD ───────────────────────────────
const listRiders = async (_req, res) => {
  try {
    await ensureRidersTable();

    const { rows: riders } = await pool.query(
      `SELECT r.id,
              r.name,
              r.phone,
              r.vehicle_type,
              r.vehicle_plate,
              r.zone_coverage,
              r.notes,
              r.is_active,
              r.created_at,
              r.updated_at,
              COUNT(d.id) FILTER (
                WHERE d.status IN ('pending', 'in_transit', 'out_for_delivery')
                  AND d.pod_verified_at IS NULL
                  AND o.status NOT IN ('delivered', 'cancelled', 'refunded')
              )::int AS active_stops,
              COUNT(d.id) FILTER (
                WHERE (d.pod_verified_at IS NOT NULL OR d.status = 'delivered')
                  AND COALESCE(d.pod_verified_at, d.updated_at) >= CURRENT_DATE
              )::int AS completed_today,
              COUNT(d.id) FILTER (
                WHERE d.pod_verified_at IS NOT NULL OR d.status = 'delivered'
              )::int AS total_completed,
              COUNT(d.id)::int AS total_assigned,
              COALESCE(SUM(o.total_amount) FILTER (
                WHERE d.status IN ('pending', 'in_transit', 'out_for_delivery')
                  AND d.pod_verified_at IS NULL
                  AND o.status NOT IN ('delivered', 'cancelled', 'refunded')
                  AND o.payment_method = 'pay_on_delivery'
                  AND COALESCE(o.payment_status, 'pending') NOT IN ('paid', 'partially_refunded', 'refunded')
              ), 0)::numeric(12,2) AS cod_pending_ghs,
              COALESCE(SUM(o.total_amount) FILTER (
                WHERE (d.pod_verified_at IS NOT NULL OR d.status = 'delivered')
                  AND COALESCE(d.pod_verified_at, d.updated_at) >= CURRENT_DATE
                  AND o.payment_method = 'pay_on_delivery'
                  AND o.payment_status IN ('paid', 'partially_refunded', 'refunded')
              ), 0)::numeric(12,2) AS cod_collected_today_ghs,
              MAX(d.created_at) AS last_dispatched_at
         FROM dispatch_riders r
         LEFT JOIN deliveries d ON LOWER(TRIM(d.delivery_partner)) = LOWER(TRIM(r.name))
         LEFT JOIN orders o ON o.id = d.order_id
        GROUP BY r.id
        ORDER BY r.is_active DESC, active_stops DESC, r.name ASC`
    );

    const { rows: legacyPartners } = await pool.query(
      `SELECT TRIM(d.delivery_partner) AS delivery_partner,
              MAX(NULLIF(TRIM(d.driver_phone), '')) AS driver_phone,
              COUNT(*) FILTER (
                WHERE d.status IN ('pending', 'in_transit', 'out_for_delivery')
                  AND d.pod_verified_at IS NULL
                  AND o.status NOT IN ('delivered', 'cancelled', 'refunded')
              )::int AS active_stops,
              COUNT(*) FILTER (
                WHERE d.pod_verified_at IS NOT NULL OR d.status = 'delivered'
              )::int AS completed_stops,
              COUNT(*)::int AS total_count
         FROM deliveries d
         JOIN orders o ON o.id = d.order_id
        WHERE d.delivery_partner IS NOT NULL
          AND TRIM(d.delivery_partner) <> ''
          AND NOT EXISTS (
            SELECT 1 FROM dispatch_riders r
             WHERE LOWER(TRIM(r.name)) = LOWER(TRIM(d.delivery_partner))
          )
        GROUP BY TRIM(d.delivery_partner)
        ORDER BY active_stops DESC, TRIM(d.delivery_partner) ASC`
    );

    res.json({ riders, legacy_partners: legacyPartners });
  } catch (err) {
    logger.error('listRiders error', { err: err.message });
    res.status(500).json({ error: 'Failed to load dispatch riders' });
  }
};

const createRider = async (req, res) => {
  try {
    await ensureRidersTable();

    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (name.length < 2 || name.length > 120) {
      return res.status(400).json({ error: 'Rider name is required (2–120 characters).' });
    }

    const { clean: phoneClean, norm: phoneNorm } = normalizeRiderPhone(req.body?.phone);
    if (!phoneClean || !phoneNorm || phoneNorm.length < 9) {
      return res.status(400).json({ error: 'A valid unique phone number is required for each rider.' });
    }

    const rawVehicle = typeof req.body?.vehicle_type === 'string' ? req.body.vehicle_type.trim().toLowerCase() : 'motorbike';
    const vehicleType = VALID_VEHICLE_TYPES.includes(rawVehicle) ? rawVehicle : 'motorbike';
    const vehiclePlate = typeof req.body?.vehicle_plate === 'string' && req.body.vehicle_plate.trim()
      ? req.body.vehicle_plate.trim().slice(0, 40)
      : null;
    const zoneCoverage = typeof req.body?.zone_coverage === 'string' && req.body.zone_coverage.trim()
      ? req.body.zone_coverage.trim().slice(0, 160)
      : null;
    const notes = typeof req.body?.notes === 'string' && req.body.notes.trim()
      ? req.body.notes.trim().slice(0, 1000)
      : null;
    const isActive = req.body?.is_active !== false;

    const { rows: dupName } = await pool.query(
      `SELECT id, name FROM dispatch_riders WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1`,
      [name]
    );
    if (dupName.length > 0) {
      return res.status(409).json({ error: `A rider named "${dupName[0].name}" already exists.` });
    }

    const { rows: dupPhone } = await pool.query(
      `SELECT id, name, phone FROM dispatch_riders WHERE phone_norm = $1 LIMIT 1`,
      [phoneNorm]
    );
    if (dupPhone.length > 0) {
      return res.status(409).json({
        error: `Phone number is already registered to "${dupPhone[0].name}" (${dupPhone[0].phone}). Each rider must have a unique phone number.`,
      });
    }

    const riderId = crypto.randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO dispatch_riders (
         id, name, phone, phone_norm, vehicle_type, vehicle_plate, zone_coverage, notes, is_active
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [riderId, name, phoneClean, phoneNorm, vehicleType, vehiclePlate, zoneCoverage, notes, isActive]
    );

    // Sync any open unverified deliveries matching this rider name to their clean phone
    await pool.query(
      `UPDATE deliveries
          SET delivery_partner = $1,
              driver_phone = $2,
              updated_at = NOW()
        WHERE LOWER(TRIM(delivery_partner)) = LOWER(TRIM($1))
          AND status IN ('pending', 'in_transit', 'out_for_delivery')
          AND pod_verified_at IS NULL`,
      [name, phoneClean]
    ).catch(() => {});

    await logAdminAction({
      actorId: req.user?.id,
      actorEmail: req.userEmail || req.user?.email,
      action: 'rider.create',
      resourceType: 'dispatch_rider',
      resourceId: riderId,
      details: { name, phone: phoneClean, vehicle_type: vehicleType },
      ip: req.ip,
    }).catch(() => {});

    res.status(201).json({ rider: rows[0], message: `Rider "${name}" added to fleet.` });
  } catch (err) {
    logger.error('createRider error', { err: err.message });
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A rider with that name or phone number already exists.' });
    }
    res.status(500).json({ error: 'Failed to create rider' });
  }
};

const updateRider = async (req, res) => {
  try {
    await ensureRidersTable();
    const { riderId } = req.params;

    const { rows: existingRows } = await pool.query(
      `SELECT * FROM dispatch_riders WHERE id = $1 LIMIT 1`,
      [riderId]
    );
    if (existingRows.length === 0) {
      return res.status(404).json({ error: 'Rider not found' });
    }
    const existing = existingRows[0];

    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : existing.name;
    if (name.length < 2 || name.length > 120) {
      return res.status(400).json({ error: 'Rider name must be 2–120 characters.' });
    }

    let phoneClean = existing.phone;
    let phoneNorm = existing.phone_norm;
    if (req.body?.phone !== undefined) {
      const parsed = normalizeRiderPhone(req.body.phone);
      if (!parsed.clean || !parsed.norm || parsed.norm.length < 9) {
        return res.status(400).json({ error: 'A valid unique phone number is required for each rider.' });
      }
      phoneClean = parsed.clean;
      phoneNorm = parsed.norm;
    }

    const { rows: dupName } = await pool.query(
      `SELECT id, name FROM dispatch_riders WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) AND id <> $2 LIMIT 1`,
      [name, riderId]
    );
    if (dupName.length > 0) {
      return res.status(409).json({ error: `Another rider is already named "${dupName[0].name}".` });
    }

    if (phoneNorm) {
      const { rows: dupPhone } = await pool.query(
        `SELECT id, name, phone FROM dispatch_riders WHERE phone_norm = $1 AND id <> $2 LIMIT 1`,
        [phoneNorm, riderId]
      );
      if (dupPhone.length > 0) {
        return res.status(409).json({
          error: `Phone number is already registered to "${dupPhone[0].name}" (${dupPhone[0].phone}). Each rider must have a unique phone number.`,
        });
      }
    }

    const rawVehicle = typeof req.body?.vehicle_type === 'string'
      ? req.body.vehicle_type.trim().toLowerCase()
      : existing.vehicle_type;
    const vehicleType = VALID_VEHICLE_TYPES.includes(rawVehicle) ? rawVehicle : existing.vehicle_type;

    const vehiclePlate = req.body?.vehicle_plate !== undefined
      ? (typeof req.body.vehicle_plate === 'string' && req.body.vehicle_plate.trim() ? req.body.vehicle_plate.trim().slice(0, 40) : null)
      : existing.vehicle_plate;

    const zoneCoverage = req.body?.zone_coverage !== undefined
      ? (typeof req.body.zone_coverage === 'string' && req.body.zone_coverage.trim() ? req.body.zone_coverage.trim().slice(0, 160) : null)
      : existing.zone_coverage;

    const notes = req.body?.notes !== undefined
      ? (typeof req.body.notes === 'string' && req.body.notes.trim() ? req.body.notes.trim().slice(0, 1000) : null)
      : existing.notes;

    const isActive = typeof req.body?.is_active === 'boolean' ? req.body.is_active : existing.is_active;

    const { rows: updatedRows } = await pool.query(
      `UPDATE dispatch_riders
          SET name = $1,
              phone = $2,
              phone_norm = $3,
              vehicle_type = $4,
              vehicle_plate = $5,
              zone_coverage = $6,
              notes = $7,
              is_active = $8,
              updated_at = NOW()
        WHERE id = $9
        RETURNING *`,
      [name, phoneClean, phoneNorm, vehicleType, vehiclePlate, zoneCoverage, notes, isActive, riderId]
    );

    // Keep open deliveries synced if rider name or phone changed
    if (existing.name !== name || existing.phone !== phoneClean) {
      await pool.query(
        `UPDATE deliveries
            SET delivery_partner = $1,
                driver_phone = $2,
                updated_at = NOW()
          WHERE LOWER(TRIM(delivery_partner)) = LOWER(TRIM($3))
            AND status IN ('pending', 'in_transit', 'out_for_delivery')
            AND pod_verified_at IS NULL`,
        [name, phoneClean, existing.name]
      ).catch(() => {});
    }

    await logAdminAction({
      actorId: req.user?.id,
      actorEmail: req.userEmail || req.user?.email,
      action: 'rider.update',
      resourceType: 'dispatch_rider',
      resourceId: riderId,
      details: { name, phone: phoneClean, is_active: isActive },
      ip: req.ip,
    }).catch(() => {});

    res.json({ rider: updatedRows[0], message: `Rider "${name}" updated.` });
  } catch (err) {
    logger.error('updateRider error', { err: err.message });
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Another rider already uses that name or phone number.' });
    }
    res.status(500).json({ error: 'Failed to update rider' });
  }
};

const deleteRider = async (req, res) => {
  try {
    await ensureRidersTable();
    const { riderId } = req.params;
    const force = req.query.force === 'true' || req.body?.force === true;

    const { rows: existingRows } = await pool.query(
      `SELECT * FROM dispatch_riders WHERE id = $1 LIMIT 1`,
      [riderId]
    );
    if (existingRows.length === 0) {
      return res.status(404).json({ error: 'Rider not found' });
    }
    const existing = existingRows[0];

    const { rows: activeCheck } = await pool.query(
      `SELECT COUNT(*)::int AS active_count
         FROM deliveries d
         JOIN orders o ON o.id = d.order_id
        WHERE LOWER(TRIM(d.delivery_partner)) = LOWER(TRIM($1))
          AND d.status IN ('pending', 'in_transit', 'out_for_delivery')
          AND d.pod_verified_at IS NULL
          AND o.status NOT IN ('delivered', 'cancelled', 'refunded')`,
      [existing.name]
    );
    const activeCount = activeCheck[0]?.active_count || 0;

    if (activeCount > 0 && !force) {
      return res.status(409).json({
        error: `"${existing.name}" currently has ${activeCount} active in-transit stop${activeCount === 1 ? '' : 's'}. Reassign them first or confirm force-delete to unassign them.`,
        active_stops: activeCount,
        requires_force: true,
      });
    }

    await pool.query(`DELETE FROM dispatch_riders WHERE id = $1`, [riderId]);

    // Clear partner tag from deliveries so deleted rider never re-appears as a legacy entry
    await pool.query(
      `UPDATE deliveries
          SET delivery_partner = CASE
                WHEN status IN ('pending', 'in_transit', 'out_for_delivery') AND pod_verified_at IS NULL
                  THEN 'In-house Dispatch Bike'
                ELSE NULL
              END,
              driver_phone = NULL,
              updated_at = NOW()
        WHERE LOWER(TRIM(delivery_partner)) = LOWER(TRIM($1))`,
      [existing.name]
    );

    await logAdminAction({
      actorId: req.user?.id,
      actorEmail: req.userEmail || req.user?.email,
      action: 'rider.delete',
      resourceType: 'dispatch_rider',
      resourceId: riderId,
      details: { name: existing.name, force, active_stops_reassigned: activeCount },
      ip: req.ip,
    }).catch(() => {});

    res.json({
      message: activeCount > 0
        ? `Deleted "${existing.name}" and reassigned ${activeCount} open delivery stop${activeCount === 1 ? '' : 's'} to In-house Dispatch Bike.`
        : `Deleted rider "${existing.name}".`,
    });
  } catch (err) {
    logger.error('deleteRider error', { err: err.message });
    res.status(500).json({ error: 'Failed to delete rider' });
  }
};

// ── Admin: Delete / clean up unregistered legacy or test rider names ──────────
const removeLegacyPartner = async (req, res) => {
  try {
    await ensureRidersTable();
    const partnerName = typeof (req.body?.delivery_partner ?? req.query?.name) === 'string'
      ? (req.body?.delivery_partner ?? req.query?.name).trim()
      : '';
    const clearAll = req.body?.clear_all === true || req.query?.clear_all === 'true';
    const forceActive = req.body?.force === true || req.query?.force === 'true';

    if (!clearAll && !partnerName) {
      return res.status(400).json({ error: 'Specify delivery_partner name or clear_all=true' });
    }

    if (clearAll) {
      const { rowCount } = await pool.query(
        `UPDATE deliveries d
            SET delivery_partner = CASE
                  WHEN d.status IN ('pending', 'in_transit', 'out_for_delivery') AND d.pod_verified_at IS NULL
                    THEN ${forceActive ? `'In-house Dispatch Bike'` : `d.delivery_partner`}
                  ELSE NULL
                END,
                driver_phone = CASE
                  WHEN d.status IN ('pending', 'in_transit', 'out_for_delivery') AND d.pod_verified_at IS NULL
                    THEN ${forceActive ? `NULL` : `d.driver_phone`}
                  ELSE NULL
                END,
                updated_at = NOW()
          WHERE d.delivery_partner IS NOT NULL
            AND TRIM(d.delivery_partner) <> ''
            AND LOWER(TRIM(d.delivery_partner)) <> 'in-house dispatch bike'
            AND NOT EXISTS (
              SELECT 1 FROM dispatch_riders r
               WHERE LOWER(TRIM(r.name)) = LOWER(TRIM(d.delivery_partner))
            )
            ${forceActive ? '' : `AND (d.pod_verified_at IS NOT NULL OR d.status = 'delivered')`}`
      );

      return res.json({
        cleared_rows: rowCount,
        message: `Cleaned up ${rowCount} historical/test rider assignment${rowCount === 1 ? '' : 's'}.`,
      });
    }

    // Single unregistered rider cleanup
    const { rows: activeCheck } = await pool.query(
      `SELECT COUNT(*)::int AS active_count
         FROM deliveries d
         JOIN orders o ON o.id = d.order_id
        WHERE LOWER(TRIM(d.delivery_partner)) = LOWER(TRIM($1))
          AND d.status IN ('pending', 'in_transit', 'out_for_delivery')
          AND d.pod_verified_at IS NULL
          AND o.status NOT IN ('delivered', 'cancelled', 'refunded')`,
      [partnerName]
    );
    const activeCount = activeCheck[0]?.active_count || 0;

    if (activeCount > 0 && !forceActive) {
      return res.status(409).json({
        error: `"${partnerName}" is currently assigned to ${activeCount} open order${activeCount === 1 ? '' : 's'}. Confirm to reassign open orders to In-house Dispatch Bike and remove "${partnerName}".`,
        active_stops: activeCount,
        requires_force: true,
      });
    }

    const { rowCount } = await pool.query(
      `UPDATE deliveries
          SET delivery_partner = CASE
                WHEN status IN ('pending', 'in_transit', 'out_for_delivery') AND pod_verified_at IS NULL
                  THEN 'In-house Dispatch Bike'
                ELSE NULL
              END,
              driver_phone = NULL,
              updated_at = NOW()
        WHERE LOWER(TRIM(delivery_partner)) = LOWER(TRIM($1))`,
      [partnerName]
    );

    res.json({
      cleared_rows: rowCount,
      message: activeCount > 0
        ? `Removed "${partnerName}" and moved ${activeCount} active stop${activeCount === 1 ? '' : 's'} to In-house Dispatch Bike.`
        : `Removed "${partnerName}".`,
    });
  } catch (err) {
    logger.error('removeLegacyPartner error', { err: err.message });
    res.status(500).json({ error: 'Failed to remove legacy rider' });
  }
};

// ── Admin: generate 1 signed Multi-Stop Rider Manifest link (20+ orders) ─────
const createRiderManifestLink = async (req, res) => {
  try {
    const rawPartner = typeof req.body?.delivery_partner === 'string' ? req.body.delivery_partner.trim() : '';
    const matchedRider = rawPartner ? await findRegisteredRiderByName(rawPartner) : null;
    const cleanPartner = matchedRider?.name || rawPartner;
    const cleanPhone = (typeof req.body?.driver_phone === 'string' && req.body.driver_phone.trim())
      ? req.body.driver_phone.trim()
      : (matchedRider?.phone || '');
    const expiresIn = MANIFEST_EXPIRY_PRESETS[req.body?.expires_in] || '7d';

    const conditions = [
      `d.status IN ('pending', 'in_transit', 'out_for_delivery')`,
      `d.pod_verified_at IS NULL`,
      `o.status NOT IN ('delivered', 'cancelled', 'refunded')`,
    ];
    const params = [];
    if (cleanPartner) {
      params.push(cleanPartner);
      conditions.push(`LOWER(TRIM(COALESCE(d.delivery_partner, ''))) = LOWER(TRIM($${params.length}))`);
    } else if (cleanPhone) {
      params.push(`%${cleanPhone.replace(/\s+/g, '')}%`);
      conditions.push(`REPLACE(COALESCE(d.driver_phone, ''), ' ', '') ILIKE $${params.length}`);
    }

    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS active_count
         FROM deliveries d
         JOIN orders o ON o.id = d.order_id
        WHERE ${conditions.join(' AND ')}`,
      params
    );

    const token = signRiderManifestToken({
      deliveryPartner: cleanPartner || null,
      driverPhone: cleanPhone || null,
      expiresIn,
    });
    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    const manifestUrl = `${frontendUrl}/rider-manifest?token=${encodeURIComponent(token)}`;

    logAdminAction({
      actorId: req.user?.id,
      actorEmail: req.userEmail,
      action: 'delivery.rider_manifest_created',
      resourceType: 'delivery',
      resourceId: null,
      details: {
        delivery_partner: cleanPartner || 'ALL',
        driver_phone: cleanPhone || null,
        expires_in: expiresIn,
        active_count: rows[0]?.active_count || 0,
      },
      ip: req.ip,
    }).catch(() => {});

    res.json({
      manifest_url: manifestUrl,
      active_count: rows[0]?.active_count || 0,
      delivery_partner: cleanPartner || 'All Active Riders',
      driver_phone: cleanPhone || null,
      expires_in: expiresIn,
    });
  } catch (err) {
    logger.error('createRiderManifestLink error', { err: err.message });
    res.status(500).json({ error: 'Failed to generate rider manifest link' });
  }
};

// ── Rider (signed manifest token): view all assigned stops + live COD tally ──
const getRiderManifest = async (req, res) => {
  try {
    const payload = verifyRiderManifestToken(req.query.token || req.headers['x-rider-manifest']);
    const matchedRider = payload.dp ? await findRegisteredRiderByName(payload.dp) : null;

    const conditions = [
      `(d.status IN ('pending', 'in_transit', 'out_for_delivery') OR (d.status = 'delivered' AND d.pod_verified_at >= CURRENT_DATE))`,
    ];
    const params = [];
    if (payload.dp) {
      params.push(payload.dp);
      conditions.push(`LOWER(TRIM(COALESCE(d.delivery_partner, ''))) = LOWER(TRIM($${params.length}))`);
    } else if (payload.ph) {
      params.push(`%${String(payload.ph).replace(/\s+/g, '')}%`);
      conditions.push(`REPLACE(COALESCE(d.driver_phone, ''), ' ', '') ILIKE $${params.length}`);
    }

    const { rows } = await pool.query(
      `SELECT d.id, d.order_id, d.status, d.tracking_number, d.zone_code,
              d.delivery_partner, d.driver_phone, d.pod_verified_at,
              d.pod_otp_hash IS NOT NULL AS has_otp,
              o.order_number, o.status AS order_status, o.total_amount, o.payment_method, o.payment_status,
              o.shipping_address, o.shipping_city, o.shipping_region,
              COALESCE(u.first_name, o.guest_first_name, 'Customer') AS customer_first_name,
              COALESCE(u.last_name, o.guest_last_name, '') AS customer_last_name,
              COALESCE(u.phone, o.guest_phone) AS customer_phone,
              (SELECT COALESCE(SUM(quantity), 0)::int FROM order_items WHERE order_id = o.id) AS item_count
         FROM deliveries d
         JOIN orders o ON o.id = d.order_id
         LEFT JOIN users u ON u.id = o.customer_id
        WHERE o.status NOT IN ('cancelled', 'refunded')
          AND ${conditions.join(' AND ')}
        ORDER BY
          CASE WHEN d.pod_verified_at IS NULL AND o.status <> 'delivered' THEN 0 ELSE 1 END ASC,
          d.zone_code ASC NULLS LAST,
          d.created_at DESC`,
      params
    );

    let completedStops = 0;
    let pendingStops = 0;
    let codCollectedGhs = 0;
    let codPendingGhs = 0;

    const stops = rows.map(r => {
      const isVerified = Boolean(r.pod_verified_at) || r.status === 'delivered' || r.order_status === 'delivered';
      const isCod = r.payment_method === 'pay_on_delivery';
      const isPaid = ['paid', 'partially_refunded', 'refunded'].includes(r.payment_status);
      const amount = Number(r.total_amount || 0);

      if (isVerified) {
        completedStops += 1;
        if (isCod && isPaid) codCollectedGhs += amount;
      } else {
        pendingStops += 1;
        if (isCod && !isPaid) codPendingGhs += amount;
      }

      const fullName = [r.customer_first_name, r.customer_last_name].filter(Boolean).join(' ').trim() || 'Customer';

      return {
        delivery_id: r.id,
        order_number: r.order_number,
        tracking_number: r.tracking_number,
        zone_code: r.zone_code || resolveGhanaZone(r.shipping_region, r.shipping_city),
        delivery_partner: r.delivery_partner,
        status: r.status,
        customer_name: fullName,
        customer_phone: r.customer_phone || null,
        address: [r.shipping_address, r.shipping_city, r.shipping_region].filter(Boolean).join(', '),
        item_count: r.item_count,
        total_amount: amount,
        payment_method: r.payment_method,
        payment_status: r.payment_status,
        cod_amount_due: (isCod && !isPaid) ? amount : 0,
        verified: isVerified,
        pod_verified_at: r.pod_verified_at,
        has_otp: Boolean(r.has_otp),
        handoff_token: isVerified ? null : signRiderToken(r.id, r.tracking_number),
      };
    });

    res.json({
      rider_label: matchedRider?.name || payload.dp || 'All Active Dispatches',
      driver_phone: matchedRider?.phone || payload.ph || null,
      vehicle_type: matchedRider?.vehicle_type || null,
      vehicle_plate: matchedRider?.vehicle_plate || null,
      summary: {
        total_stops: stops.length,
        completed_stops: completedStops,
        pending_stops: pendingStops,
        cod_collected_ghs: Number(codCollectedGhs.toFixed(2)),
        cod_pending_ghs: Number(codPendingGhs.toFixed(2)),
      },
      stops,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Failed to load rider manifest' });
  }
};

// ── Rider (signed pod OR manifest token): resend fresh 6-digit OTP at doorstep ─
const riderResendPodOtp = async (req, res) => {
  try {
    const rawToken = req.body?.token || req.headers['x-rider-token'] || req.headers['x-rider-manifest'];
    if (!rawToken || typeof rawToken !== 'string') {
      return res.status(401).json({ error: 'Missing rider authentication token' });
    }

    let payload;
    try {
      payload = jwt.verify(rawToken, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    } catch {
      return res.status(401).json({ error: 'Invalid or expired rider link' });
    }

    let deliveryId = null;
    if (payload?.purpose === 'rider_pod' && payload?.sub) {
      deliveryId = payload.sub;
    } else if (payload?.purpose === 'rider_manifest' && req.body?.delivery_id) {
      deliveryId = req.body.delivery_id;
    } else {
      return res.status(400).json({ error: 'delivery_id is required when using a manifest link' });
    }

    const { rows } = await pool.query(
      `SELECT d.*, o.order_number, o.customer_id, o.guest_email, o.guest_phone,
              o.guest_first_name, o.shipping_city, o.shipping_region,
              u.email AS user_email, u.first_name AS user_first_name, u.phone AS user_phone
         FROM deliveries d
         JOIN orders o ON o.id = d.order_id
         LEFT JOIN users u ON u.id = o.customer_id
        WHERE d.id = $1`,
      [deliveryId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Delivery not found' });

    const d = rows[0];
    if (d.pod_verified_at) {
      return res.status(409).json({ error: 'Delivery is already verified' });
    }

    // If using a scoped manifest token, ensure this delivery belongs to that rider scope
    if (payload.purpose === 'rider_manifest') {
      if (payload.dp && String(d.delivery_partner || '').trim().toLowerCase() !== String(payload.dp).trim().toLowerCase()) {
        return res.status(403).json({ error: 'Delivery is not assigned to this rider manifest' });
      }
      if (payload.ph) {
        const normAssigned = String(d.driver_phone || '').replace(/\s+/g, '');
        const normScope = String(payload.ph).replace(/\s+/g, '');
        if (!normAssigned.includes(normScope)) {
          return res.status(403).json({ error: 'Delivery is not assigned to this rider phone' });
        }
      }
    }

    const otp = String(crypto.randomInt(100000, 1000000));
    const otpHash = hashPodOtp(otp);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    const zoneCode = d.zone_code || resolveGhanaZone(d.shipping_region, d.shipping_city);

    await pool.query(
      `UPDATE deliveries
          SET pod_otp_hash = $1,
              pod_otp_expires_at = $2,
              pod_otp_attempts = 0,
              zone_code = COALESCE(zone_code, $3),
              updated_at = NOW()
        WHERE id = $4`,
      [otpHash, expiresAt, zoneCode, d.id]
    );

    const phone = d.user_phone || d.guest_phone;
    const email = d.user_email || d.guest_email;
    const firstName = d.user_first_name || d.guest_first_name || 'Valued Customer';

    if (phone) {
      notify.sendSms({
        to: phone,
        message: `BodyCream GH: Your rider is at the door! Your 6-digit delivery code for order #${d.order_number} is ${otp}. Share ONLY after inspecting your parcel.`,
      }).catch(err => logger.warn('Rider resend OTP SMS failed', { err: err.message }));
    }

    const sendDeliveryOtp = emailService.sendDeliveryOtpEmail || emailService.sendOtpEmail;
    if (email && typeof sendDeliveryOtp === 'function') {
      sendDeliveryOtp(email, { firstName, otp, orderNumber: d.order_number })
        .catch(err => logger.warn('Rider resend OTP email failed', { err: err.message }));
    }

    if (d.customer_id) {
      notify.sendPushNotification({
        userId: d.customer_id,
        title: `Rider Arrived · Code: ${otp}`,
        body: `Your 6-digit delivery code for order #${d.order_number} is ${otp}.`,
        data: { order_number: d.order_number, type: 'pod_otp' },
      }).catch(() => {});
    }

    const response = {
      message: 'Fresh 6-digit delivery code sent to customer!',
      expires_at: expiresAt.toISOString(),
    };
    res.json(response);
  } catch (err) {
    logger.error('riderResendPodOtp error', { err: err.message });
    res.status(500).json({ error: 'Failed to resend delivery code' });
  }
};

module.exports = {
  ensureRidersTable,
  createDelivery,
  bulkDispatch,
  trackShipment,
  getDeliveryByOrder,
  updateDelivery,
  sendPodOtp,
  getRiderHandoff,
  confirmRiderDelivery,
  confirmCustomerReceipt,
  requireRiderToken,
  getDeliveryPartners,
  listRiders,
  createRider,
  updateRider,
  deleteRider,
  removeLegacyPartner,
  createRiderManifestLink,
  getRiderManifest,
  riderResendPodOtp,
};

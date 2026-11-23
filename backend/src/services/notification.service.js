// Notification service — handles SMS (Arkesel, Hubtel, mNotify) and FCM mobile push notifications
'use strict';

const axios = require('axios');
const pool = require('../config/database');

const LEVELS = { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' };

function log(level, event, payload) {
  const ts = new Date().toISOString();
  console.log(JSON.stringify({ ts, level, event, ...payload }));
}

/**
 * Normalizes Ghanaian phone numbers into international format (233XXXXXXXXX).
 * Handles: 024XXXXXXX -> 23324XXXXXXX, +23324... -> 23324..., 23324... -> 23324...
 */
function normalizeGhanaPhone(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('0')) {
    return `233${digits.slice(1)}`;
  }
  if (digits.startsWith('233') && digits.length === 12) {
    return digits;
  }
  return digits;
}

/**
 * Dispatches transactional SMS via Arkesel, Hubtel, or mNotify.
 * Gracefully logs and returns if provider is not configured.
 */
async function sendSms({ to, message }) {
  const provider = String(process.env.SMS_PROVIDER || '').trim().toLowerCase();
  const apiKey = process.env.SMS_API_KEY;
  const senderId = process.env.SMS_SENDER_ID || 'BodyCreamGH';
  const recipient = normalizeGhanaPhone(to);

  if (!provider || !apiKey || !recipient || !message) {
    log(LEVELS.INFO, 'sms.skipped', {
      provider: provider || 'none',
      hasTo: Boolean(recipient),
      toPreview: recipient ? `${recipient.slice(0, 5)}***` : null,
      msgSample: message ? message.slice(0, 40) : null,
    });
    return { sent: false, reason: 'SMS provider not configured' };
  }

  try {
    if (provider === 'hubtel') {
      await axios.get('https://smsc.hubtel.com/v1/messages/send', {
        params: {
          clientid: process.env.SMS_CLIENT_ID || '',
          clientsecret: apiKey,
          from: senderId,
          to: recipient,
          content: message,
        },
        timeout: 10000,
      });
    } else if (provider === 'arkesel' || provider === 'arkese') {
      await axios.post(
        'https://sms.arkesel.com/api/v2/sms/send',
        { sender: senderId, message, recipients: [recipient] },
        { headers: { 'api-key': apiKey }, timeout: 10000 }
      );
    } else if (provider === 'mnotify') {
      await axios.post(
        `https://api.mnotify.com/api/sms/quick?key=${encodeURIComponent(apiKey)}`,
        { recipient: [recipient], sender: senderId, message },
        { timeout: 10000 }
      );
    } else {
      log(LEVELS.WARN, 'sms.unknown_provider', { provider });
      return { sent: false, reason: `Unsupported SMS provider: ${provider}` };
    }
    log(LEVELS.INFO, 'sms.sent', { provider, to: `${recipient.slice(0, 5)}***` });
    return { sent: true, provider };
  } catch (err) {
    log(LEVELS.ERROR, 'sms.failed', { provider, to: recipient, err: err.message });
    return { sent: false, reason: err.message };
  }
}

/**
 * Sends a transactional order update SMS to a customer.
 */
async function sendOrderStatusSms({ phone, orderNumber, status, amount, courierNote }) {
  if (!phone) return { sent: false, reason: 'No phone number provided' };

  let message = '';
  switch (status) {
    case 'confirmed':
      message = `BodyCream GH: Order #${orderNumber} (${amount ? `GHS ${Number(amount).toFixed(2)}` : 'confirmed'}) has been received and is being prepared! Track: https://bodycreamgh.com/track`;
      break;
    case 'processing':
      message = `BodyCream GH: Order #${orderNumber} is now being packaged with care. We will alert you once dispatched!`;
      break;
    case 'shipped':
      message = `BodyCream GH: Your order #${orderNumber} is out for delivery! ${courierNote ? `Note: ${courierNote}. ` : ''}Please keep your phone active.`;
      break;
    case 'delivered':
      message = `BodyCream GH: Order #${orderNumber} has been delivered! Thank you for glowing with us. Leave a review for 5% off your next order.`;
      break;
    default:
      message = `BodyCream GH: Order #${orderNumber} status update: ${status}. Track at https://bodycreamgh.com/track`;
  }

  return sendSms({ to: phone, message });
}

/**
 * Registers an FCM push token for a user device.
 */
async function registerDeviceToken({ userId, fcmToken, platform = 'android', deviceName = '' }) {
  if (!userId || !fcmToken) return null;
  const { rows } = await pool.query(
    `INSERT INTO user_devices (user_id, fcm_token, platform, device_name, last_active_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (fcm_token) DO UPDATE
     SET user_id = EXCLUDED.user_id,
         platform = EXCLUDED.platform,
         device_name = EXCLUDED.device_name,
         last_active_at = NOW()
     RETURNING id, user_id, platform`,
    [userId, fcmToken, platform, deviceName]
  );
  log(LEVELS.INFO, 'fcm.device_registered', { userId, platform });
  return rows[0];
}

/**
 * Dispatches an FCM push notification to all devices registered to a user.
 */
async function sendPushNotification({ userId, title, body, data = {} }) {
  if (!userId) return { sent: 0 };

  const { rows: devices } = await pool.query(
    `SELECT fcm_token, platform FROM user_devices WHERE user_id = $1`,
    [userId]
  );

  if (!devices.length) {
    log(LEVELS.INFO, 'fcm.no_devices', { userId });
    return { sent: 0, reason: 'No registered devices' };
  }

  const fcmServerKey = process.env.FCM_SERVER_KEY;
  if (!fcmServerKey) {
    log(LEVELS.INFO, 'fcm.skipped', {
      userId,
      deviceCount: devices.length,
      title,
      body,
      reason: 'FCM_SERVER_KEY not configured',
    });
    return { sent: devices.length, mocked: true };
  }

  let successCount = 0;
  for (const dev of devices) {
    try {
      await axios.post(
        'https://fcm.googleapis.com/fcm/send',
        {
          to: dev.fcm_token,
          notification: { title, body, sound: 'default' },
          data,
        },
        {
          headers: {
            Authorization: `key=${fcmServerKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 8000,
        }
      );
      successCount++;
    } catch (err) {
      log(LEVELS.WARN, 'fcm.send_failed', { token: dev.fcm_token.slice(0, 10), err: err.message });
    }
  }

  log(LEVELS.INFO, 'fcm.dispatched', { userId, sent: successCount, total: devices.length });
  return { sent: successCount, total: devices.length };
}

/**
 * Sends order tracking push notification to a user's mobile app.
 */
async function sendOrderStatusPush({ userId, orderNumber, status }) {
  if (!userId) return;

  const titles = {
    confirmed: 'Order Confirmed! ✨',
    processing: 'Order Being Packaged 📦',
    shipped: 'Out for Delivery! 🚚',
    delivered: 'Your Package Has Arrived! 💖',
  };

  const bodies = {
    confirmed: `We've received your order #${orderNumber} and reserved your products.`,
    processing: `Our team is carefully preparing and packaging your order #${orderNumber}.`,
    shipped: `Your skincare parcel is on its way with the dispatch rider!`,
    delivered: `Your order #${orderNumber} has been delivered. Enjoy your glow!`,
  };

  const title = titles[status] || `Order #${orderNumber} Update`;
  const body = bodies[status] || `Your order status has changed to: ${status}`;

  return sendPushNotification({
    userId,
    title,
    body,
    data: { order_number: orderNumber, status },
  });
}

const notify = {
  paymentSuccess({ orderNumber, email, amount }) {
    log(LEVELS.INFO, 'payment.success', {
      msg: `Payment confirmed for order ${orderNumber}`,
      email,
      amount: `GHS ${Number(amount).toFixed(2)}`,
    });
  },

  shipmentCreated({ orderNumber, trackingNumber, orderId }) {
    log(LEVELS.INFO, 'shipment.created', {
      msg: `Shipment created for order ${orderNumber}`,
      trackingNumber,
      orderId,
    });
  },

  shipmentUpdated({ trackingNumber, from, to }) {
    log(LEVELS.INFO, 'shipment.updated', {
      msg: `Shipment ${trackingNumber} moved: ${from} → ${to}`,
      trackingNumber,
      from,
      to,
    });
  },

  shipmentDelivered({ trackingNumber, orderNumber }) {
    log(LEVELS.INFO, 'shipment.delivered', {
      msg: `Order ${orderNumber} delivered. Tracking: ${trackingNumber}`,
      trackingNumber,
    });
  },

  orderStatusChanged({ orderNumber, from, to }) {
    log(LEVELS.INFO, 'order.status_changed', {
      msg: `Order ${orderNumber}: ${from} → ${to}`,
    });
  },

  normalizeGhanaPhone,
  sendSms,
  sendOrderStatusSms,
  registerDeviceToken,
  sendPushNotification,
  sendOrderStatusPush,
};

module.exports = notify;

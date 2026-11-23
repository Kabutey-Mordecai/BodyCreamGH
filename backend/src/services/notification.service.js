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

// Startup check for SMS_SENDER_ID (max 11 alphanumeric characters)
const _rawSenderId = (process.env.SMS_SENDER_ID || '').trim();
if (_rawSenderId && (/[^a-zA-Z0-9]/.test(_rawSenderId) || _rawSenderId.length > 11)) {
  log(LEVELS.WARN, 'sms.invalid_sender_id', {
    configuredLength: _rawSenderId.length,
    reason: 'SMS_SENDER_ID must be <= 11 alphanumeric characters; sanitized value will be used',
  });
}

/**
 * Validates provider response payload and returns an error message only when the
 * gateway explicitly reports a failure inside an HTTP 2xx response.
 */
function validateSmsResponse(_provider, data) {
  if (!data || typeof data !== 'object') return null;
  if (data.status === 'error') {
    return data.message || data.error || 'SMS gateway error';
  }
  if (typeof data.error === 'string' && data.error.trim()) {
    return data.error;
  }
  if (data.error && typeof data.error === 'object' && data.error.message) {
    return data.error.message;
  }
  return null;
}

async function dispatchSmsViaProvider({ provider, apiKey, cleanSender, recipient, message, maskedTo }) {
  if (!provider || !apiKey) {
    return { sent: false, provider: provider || 'none', reason: 'SMS provider not configured' };
  }

  try {
    let response;
    if (provider === 'brevo') {
      const e164 = recipient.startsWith('+') ? recipient : `+${recipient}`;
      response = await axios.post(
        'https://api.brevo.com/v3/transactionalSMS/sms',
        {
          sender: cleanSender,
          recipient: e164,
          content: message,
          type: 'transactional',
        },
        {
          headers: {
            'api-key': apiKey,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          timeout: 10000,
        }
      );
    } else if (provider === 'hubtel') {
      response = await axios.get('https://smsc.hubtel.com/v1/messages/send', {
        params: {
          clientid: process.env.SMS_CLIENT_ID || '',
          clientsecret: apiKey,
          from: cleanSender,
          to: recipient,
          content: message,
        },
        timeout: 10000,
      });
    } else if (provider === 'arkesel' || provider === 'arkese') {
      response = await axios.post(
        'https://sms.arkesel.com/api/v2/sms/send',
        { sender: cleanSender, message, recipients: [recipient] },
        { headers: { 'api-key': apiKey }, timeout: 10000 }
      );
    } else if (provider === 'mnotify') {
      response = await axios.post(
        `https://api.mnotify.com/api/sms/quick?key=${encodeURIComponent(apiKey)}`,
        { recipient: [recipient], sender: cleanSender, message },
        { timeout: 10000 }
      );
    } else {
      log(LEVELS.WARN, 'sms.unknown_provider', { provider });
      return { sent: false, provider, reason: `Unsupported SMS provider: ${provider}` };
    }

    const payloadError = validateSmsResponse(provider, response && response.data);
    if (payloadError) {
      log(LEVELS.ERROR, 'sms.failed', { provider, to: maskedTo, err: payloadError });
      return { sent: false, provider, reason: payloadError };
    }

    log(LEVELS.INFO, 'sms.sent', { provider, to: maskedTo });
    return { sent: true, provider, reason: null };
  } catch (err) {
    const errMsg =
      (err && err.response && err.response.data && err.response.data.message) ||
      (err && err.message) ||
      String(err);
    log(LEVELS.ERROR, 'sms.failed', { provider, to: maskedTo, err: errMsg });
    return { sent: false, provider, reason: errMsg };
  }
}

/**
 * Dispatches transactional SMS via Arkesel, Hubtel, mNotify, or Brevo.
 * If SMS_FALLBACK_PROVIDER is configured, it is tried once ONLY if the primary
 * provider returns sent:false (never sends a duplicate when primary succeeds).
 */
async function sendSms({ to, message }) {
  const configuredProvider = String(process.env.SMS_PROVIDER || '').trim().toLowerCase();
  const brevoKey = (process.env.BREVO_API_KEY || '').trim();
  const provider = configuredProvider || (brevoKey ? 'brevo' : '');
  const apiKey = provider === 'brevo' ? (process.env.SMS_API_KEY || brevoKey) : process.env.SMS_API_KEY;
  const senderId = process.env.SMS_SENDER_ID || 'BodyCreamGH';
  const cleanSender = String(senderId || 'BodyCreamGH').replace(/[^a-zA-Z0-9]/g, '').slice(0, 11) || 'BodyCreamGH';
  const recipient = normalizeGhanaPhone(to);
  const maskedTo = recipient ? `***${recipient.slice(-3)}` : null;

  if (!provider || !apiKey || !recipient || !message) {
    log(LEVELS.INFO, 'sms.skipped', {
      provider: provider || 'none',
      hasTo: Boolean(recipient),
      toPreview: maskedTo,
    });
    return { sent: false, provider: provider || 'none', reason: 'SMS provider not configured' };
  }

  const primaryResult = await dispatchSmsViaProvider({
    provider,
    apiKey,
    cleanSender,
    recipient,
    message,
    maskedTo,
  });

  if (primaryResult.sent) {
    return primaryResult;
  }

  const fallbackProvider = String(process.env.SMS_FALLBACK_PROVIDER || '').trim().toLowerCase();
  if (fallbackProvider && fallbackProvider !== provider) {
    const fallbackKey = fallbackProvider === 'brevo'
      ? (process.env.SMS_FALLBACK_API_KEY || brevoKey)
      : process.env.SMS_FALLBACK_API_KEY;
    if (fallbackKey) {
      return dispatchSmsViaProvider({
        provider: fallbackProvider,
        apiKey: fallbackKey,
        cleanSender,
        recipient,
        message,
        maskedTo,
      });
    }
  }

  return primaryResult;
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

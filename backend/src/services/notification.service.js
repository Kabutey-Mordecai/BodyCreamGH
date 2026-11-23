// Notification service — in production this would dispatch to SMS, push, or email.
// For now it writes structured logs so the flow is clearly observable.

const axios = require('axios');

const LEVELS = { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' };

function log(level, event, payload) {
  const ts = new Date().toISOString();
  console.log(JSON.stringify({ ts, level, event, ...payload }));
}

async function sendSms({ to, message }) {
  const provider = String(process.env.SMS_PROVIDER || '').trim().toLowerCase();
  const apiKey = process.env.SMS_API_KEY;
  const senderId = process.env.SMS_SENDER_ID || 'GlowHaus';

  if (!provider || !apiKey || !to || !message) {
    log(LEVELS.INFO, 'sms.skipped', { provider: provider || 'none', hasTo: Boolean(to) });
    return { sent: false, reason: 'SMS provider not configured' };
  }

  try {
    if (provider === 'hubtel') {
      await axios.get('https://smsc.hubtel.com/v1/messages/send', {
        params: {
          clientid: process.env.SMS_CLIENT_ID || '',
          clientsecret: apiKey,
          from: senderId,
          to,
          content: message,
        },
        timeout: 10000,
      });
    } else if (provider === 'arkese') {
      await axios.post(
        'https://sms.arkesel.com/api/v2/sms/send',
        { sender: senderId, message, recipients: [to] },
        { headers: { 'api-key': apiKey }, timeout: 10000 }
      );
    } else if (provider === 'mnotify') {
      await axios.post(
        `https://api.mnotify.com/api/sms/quick?key=${encodeURIComponent(apiKey)}`,
        { recipient: [to], sender: senderId, message },
        { timeout: 10000 }
      );
    } else {
      log(LEVELS.WARN, 'sms.unknown_provider', { provider });
      return { sent: false, reason: `Unsupported SMS provider: ${provider}` };
    }
    log(LEVELS.INFO, 'sms.sent', { provider, to });
    return { sent: true, provider };
  } catch (err) {
    log(LEVELS.ERROR, 'sms.failed', { provider, to, err: err.message });
    return { sent: false, reason: err.message };
  }
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

  sendSms,
};

module.exports = notify;

const nodemailer = require('nodemailer');

// Single transporter instance reused across all sends.
// requireTLS forces STARTTLS upgrade on port 587 (Gmail requires it).
let _transporter = null;
function getTransporter() {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host:       process.env.SMTP_HOST,
      port:       parseInt(process.env.SMTP_PORT) || 587,
      secure:     false,
      requireTLS: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return _transporter;
}

// Call once at server startup. Logs a clear warning if SMTP credentials are
// wrong so the problem surfaces immediately rather than silently on first use.
const verifyTransporter = async () => {
  if (!isConfigured()) return;
  try {
    await getTransporter().verify();
    const logger = require('../utils/logger');
    logger.info('SMTP connection verified', { user: process.env.SMTP_USER });
  } catch (err) {
    const logger = require('../utils/logger');
    logger.error('SMTP verification failed — emails will not send', { err: err.message });
    // Reset so the next send attempt gets a fresh transporter if config changes.
    _transporter = null;
  }
};

const PLACEHOLDER_PASSWORDS = new Set([
  'your_app_password',
  'change_me',
  'changeme',
  'placeholder',
  'change_me_app_password',
]);

const isConfigured = () => {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return false;
  if (PLACEHOLDER_PASSWORDS.has(pass.toLowerCase())) {
    // Log once per process startup rather than on every email attempt.
    // Uses console.error so it appears even before the logger is ready.
    console.error(
      '[email] SMTP_PASS appears to be a placeholder — email sending is disabled. ' +
      'Set a real Gmail App Password in SMTP_PASS.'
    );
    return false;
  }
  return true;
};

const sendOrderConfirmation = async (to, { orderNumber, total, items = [] }) => {
  if (!isConfigured() || !to) return;

  const itemRows = items
    .map(i => `<tr><td>${i.name}</td><td>${i.quantity}</td><td>GHS ${parseFloat(i.price_at_purchase).toFixed(2)}</td></tr>`)
    .join('');

  await getTransporter().sendMail({
    from: `Cosmetics Store <${process.env.SMTP_USER}>`,
    to,
    subject: `Order Confirmed – ${orderNumber}`,
    html: `
      <h2>Thank you for your order!</h2>
      <p>Order number: <strong>${orderNumber}</strong></p>
      <table border="1" cellpadding="8" style="border-collapse:collapse">
        <thead><tr><th>Product</th><th>Qty</th><th>Price</th></tr></thead>
        <tbody>${itemRows}</tbody>
      </table>
      <p style="margin-top:12px"><strong>Total: GHS ${parseFloat(total).toFixed(2)}</strong></p>
      <p>We will notify you once your order ships.</p>
    `,
  });
};

const sendWelcomeEmail = async (to, firstName) => {
  if (!isConfigured() || !to) return;

  await getTransporter().sendMail({
    from: `Cosmetics Store <${process.env.SMTP_USER}>`,
    to,
    subject: 'Welcome to our store!',
    html: `<h2>Welcome${firstName ? `, ${firstName}` : ''}!</h2>
           <p>Your account has been created. Start shopping today!</p>`,
  });
};

const sendShippingNotification = async (to, { orderNumber, trackingNumber, deliveryPartner }) => {
  if (!isConfigured() || !to) return;

  await getTransporter().sendMail({
    from: `Cosmetics Store <${process.env.SMTP_USER}>`,
    to,
    subject: `Your order ${orderNumber} has shipped!`,
    html: `
      <h2>Your order is on its way!</h2>
      <p>Order: <strong>${orderNumber}</strong></p>
      ${deliveryPartner ? `<p>Delivery partner: ${deliveryPartner}</p>` : ''}
      ${trackingNumber ? `<p>Tracking number: <strong>${trackingNumber}</strong></p>` : ''}
    `,
  });
};

const sendPasswordResetEmail = async (to, resetUrl) => {
  if (!isConfigured() || !to) return;

  await getTransporter().sendMail({
    from: `Cosmetics Store <${process.env.SMTP_USER}>`,
    to,
    subject: 'Reset your password',
    html: `
      <h2>Password Reset Request</h2>
      <p>We received a request to reset your password. Click the link below to choose a new one:</p>
      <p>
        <a href="${resetUrl}" style="background:#000;color:#fff;padding:12px 24px;border-radius:4px;text-decoration:none;display:inline-block;">
          Reset Password
        </a>
      </p>
      <p>This link expires in <strong>1 hour</strong>.</p>
      <p>If you did not request a password reset, you can safely ignore this email.</p>
    `,
  });
};

const sendReviewRequest = async (to, { customerName, orderNumber, items = [], frontendUrl }) => {
  if (!isConfigured() || !to) return;

  const url = frontendUrl || process.env.FRONTEND_URL || 'http://localhost:5173';
  const itemList = items
    .map(i => `<li style="margin-bottom:8px"><strong>${i.name}</strong></li>`)
    .join('');

  await getTransporter().sendMail({
    from: `Cosmetics Store <${process.env.SMTP_USER}>`,
    to,
    subject: `Your order ${orderNumber} has arrived — how did we do?`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
        <h2 style="font-size:22px">Your order has been delivered! 🎉</h2>
        ${customerName ? `<p>Hi ${customerName},</p>` : ''}
        <p>We hope you're loving your new products. It would mean a lot if you shared your thoughts:</p>
        <ul style="padding-left:20px">${itemList}</ul>
        <p style="margin-top:24px">
          <a href="${url}/orders" style="background:#c9a55a;color:#fff;padding:12px 28px;border-radius:4px;text-decoration:none;font-weight:600;display:inline-block">
            Leave a Review
          </a>
        </p>
        <p style="margin-top:20px;color:#888;font-size:12px">Order: ${orderNumber}</p>
      </div>
    `,
  });
};

const sendOrderCancellation = async (to, { customerName, orderNumber }) => {
  if (!isConfigured() || !to) return;

  await getTransporter().sendMail({
    from: `Cosmetics Store <${process.env.SMTP_USER}>`,
    to,
    subject: `Your order ${orderNumber} has been cancelled`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
        <h2>Order Cancelled</h2>
        ${customerName ? `<p>Hi ${customerName},</p>` : ''}
        <p>Your order <strong>${orderNumber}</strong> has been cancelled.</p>
        <p>If you did not request this cancellation or have any questions, please contact our support team.</p>
      </div>
    `,
  });
};

const sendRefundNotification = async (to, { customerName, orderNumber, total }) => {
  if (!isConfigured() || !to) return;

  await getTransporter().sendMail({
    from: `Cosmetics Store <${process.env.SMTP_USER}>`,
    to,
    subject: `Refund processed for order ${orderNumber}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
        <h2>Refund Processed</h2>
        ${customerName ? `<p>Hi ${customerName},</p>` : ''}
        <p>A refund of <strong>GHS ${parseFloat(total).toFixed(2)}</strong> has been processed for order <strong>${orderNumber}</strong>.</p>
        <p>Please allow 5-10 business days for the amount to reflect in your account.</p>
      </div>
    `,
  });
};

// ── Customer: cancel / return request confirmations ──────────────────────────

const sendCancelRequested = async (to, { customerName, orderNumber }) => {
  if (!isConfigured() || !to) return;
  await getTransporter().sendMail({
    from: `Cosmetics Store <${process.env.SMTP_USER}>`,
    to,
    subject: `Cancellation request received for order ${orderNumber}`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <h2>Cancellation Request Received</h2>
      ${customerName ? `<p>Hi ${customerName},</p>` : ''}
      <p>We received your cancellation request for order <strong>${orderNumber}</strong>.</p>
      <p>Our team will review it shortly and notify you of the outcome.</p>
    </div>`,
  });
};

const sendCancelRejected = async (to, { customerName, orderNumber }) => {
  if (!isConfigured() || !to) return;
  await getTransporter().sendMail({
    from: `Cosmetics Store <${process.env.SMTP_USER}>`,
    to,
    subject: `Cancellation request not approved — order ${orderNumber}`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <h2>Cancellation Request Not Approved</h2>
      ${customerName ? `<p>Hi ${customerName},</p>` : ''}
      <p>Unfortunately, your cancellation request for order <strong>${orderNumber}</strong> could not be approved at this time.</p>
      <p>If you have questions, please contact our support team.</p>
    </div>`,
  });
};

const sendReturnRequested = async (to, { customerName, orderNumber }) => {
  if (!isConfigured() || !to) return;
  await getTransporter().sendMail({
    from: `Cosmetics Store <${process.env.SMTP_USER}>`,
    to,
    subject: `Return request received for order ${orderNumber}`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <h2>Return Request Received</h2>
      ${customerName ? `<p>Hi ${customerName},</p>` : ''}
      <p>We received your return request for order <strong>${orderNumber}</strong>.</p>
      <p>Our team will review it and get back to you. If approved, a refund will be processed.</p>
    </div>`,
  });
};

const sendReturnRejected = async (to, { customerName, orderNumber }) => {
  if (!isConfigured() || !to) return;
  await getTransporter().sendMail({
    from: `Cosmetics Store <${process.env.SMTP_USER}>`,
    to,
    subject: `Return request not approved — order ${orderNumber}`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <h2>Return Request Not Approved</h2>
      ${customerName ? `<p>Hi ${customerName},</p>` : ''}
      <p>Unfortunately, your return request for order <strong>${orderNumber}</strong> could not be approved at this time.</p>
      <p>If you have questions, please contact our support team.</p>
    </div>`,
  });
};

// ── Admin alert emails ────────────────────────────────────────────────────────

const sendAdminNewOrder = async (to, { orderNumber, total, customerName }) => {
  if (!isConfigured() || !to) return;
  await getTransporter().sendMail({
    from: `Cosmetics Store <${process.env.SMTP_USER}>`,
    to,
    subject: `New order received — ${orderNumber}`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <h2>New Order Received</h2>
      <p>Order <strong>${orderNumber}</strong> has been paid and confirmed.</p>
      <p>Customer: ${customerName || 'Guest'}</p>
      <p>Total: <strong>GHS ${parseFloat(total).toFixed(2)}</strong></p>
    </div>`,
  });
};

const sendAdminCancelRequest = async (to, { orderNumber, customerName, reason }) => {
  if (!isConfigured() || !to) return;
  await getTransporter().sendMail({
    from: `Cosmetics Store <${process.env.SMTP_USER}>`,
    to,
    subject: `Action needed: cancellation request for order ${orderNumber}`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <h2>Cancellation Request — Action Required</h2>
      <p>Customer <strong>${customerName || 'Guest'}</strong> has requested cancellation for order <strong>${orderNumber}</strong>.</p>
      ${reason ? `<p>Reason: ${reason}</p>` : ''}
      <p>Please review and approve or reject the request in the admin panel.</p>
    </div>`,
  });
};

const sendAdminCancelRejected = async (to, { orderNumber }) => {
  if (!isConfigured() || !to) return;
  await getTransporter().sendMail({
    from: `Cosmetics Store <${process.env.SMTP_USER}>`,
    to,
    subject: `Cancellation request rejected — order ${orderNumber}`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <h2>Cancellation Request Rejected</h2>
      <p>The cancellation request for order <strong>${orderNumber}</strong> has been rejected.</p>
      <p>The customer has been notified.</p>
    </div>`,
  });
};

const sendAdminReturnRequest = async (to, { orderNumber, customerName, reason }) => {
  if (!isConfigured() || !to) return;
  await getTransporter().sendMail({
    from: `Cosmetics Store <${process.env.SMTP_USER}>`,
    to,
    subject: `Action needed: return request for order ${orderNumber}`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <h2>Return Request — Action Required</h2>
      <p>Customer <strong>${customerName || 'Guest'}</strong> has requested a return for order <strong>${orderNumber}</strong>.</p>
      ${reason ? `<p>Reason: ${reason}</p>` : ''}
      <p>Please review and approve or reject the request in the admin panel.</p>
    </div>`,
  });
};

const sendAdminReturnRejected = async (to, { orderNumber }) => {
  if (!isConfigured() || !to) return;
  await getTransporter().sendMail({
    from: `Cosmetics Store <${process.env.SMTP_USER}>`,
    to,
    subject: `Return request rejected — order ${orderNumber}`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <h2>Return Request Rejected</h2>
      <p>The return request for order <strong>${orderNumber}</strong> has been rejected.</p>
      <p>The customer has been notified.</p>
    </div>`,
  });
};

const sendAdminOrderCancelled = async (to, { orderNumber }) => {
  if (!isConfigured() || !to) return;
  await getTransporter().sendMail({
    from: `Cosmetics Store <${process.env.SMTP_USER}>`,
    to,
    subject: `Order cancelled — ${orderNumber}`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <h2>Order Cancelled</h2>
      <p>Order <strong>${orderNumber}</strong> has been cancelled. Stock has been restored.</p>
    </div>`,
  });
};

const sendAdminOrderRefunded = async (to, { orderNumber, total }) => {
  if (!isConfigured() || !to) return;
  await getTransporter().sendMail({
    from: `Cosmetics Store <${process.env.SMTP_USER}>`,
    to,
    subject: `Refund processed — order ${orderNumber}`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <h2>Refund Processed</h2>
      <p>A refund of <strong>GHS ${parseFloat(total).toFixed(2)}</strong> has been processed for order <strong>${orderNumber}</strong>.</p>
    </div>`,
  });
};

const sendAdminOrderShipped = async (to, { orderNumber, trackingNumber }) => {
  if (!isConfigured() || !to) return;
  await getTransporter().sendMail({
    from: `Cosmetics Store <${process.env.SMTP_USER}>`,
    to,
    subject: `Order shipped — ${orderNumber}`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <h2>Order Shipped</h2>
      <p>Order <strong>${orderNumber}</strong> has been shipped.</p>
      ${trackingNumber ? `<p>Tracking number: <strong>${trackingNumber}</strong></p>` : ''}
    </div>`,
  });
};

const sendAdminOrderDelivered = async (to, { orderNumber }) => {
  if (!isConfigured() || !to) return;
  await getTransporter().sendMail({
    from: `Cosmetics Store <${process.env.SMTP_USER}>`,
    to,
    subject: `Order delivered — ${orderNumber}`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <h2>Order Delivered</h2>
      <p>Order <strong>${orderNumber}</strong> has been marked as delivered.</p>
    </div>`,
  });
};

// ── Newsletter emails ─────────────────────────────────────────────────────────

const sendNewsletterWelcome = async (to, { name, unsubscribeUrl }) => {
  if (!isConfigured() || !to) return;
  const storeName = process.env.STORE_NAME || 'BodyCreamGH';
  await getTransporter().sendMail({
    from: `${storeName} <${process.env.SMTP_USER}>`,
    to,
    subject: `You're in! Here's your 1% off`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
        <h2 style="font-size:24px;margin-bottom:8px">You're officially on the list! 🎉</h2>
        ${name ? `<p>Hi ${name},</p>` : ''}
        <p>Welcome to the <strong>${storeName}</strong> newsletter. As a thank-you for subscribing,
           enjoy <strong>1% off</strong> your next order.</p>
        <p style="margin-top:20px">Expect exclusive offers, new arrivals, and skincare tips — straight to your inbox.</p>
        <div style="margin-top:40px;padding-top:20px;border-top:1px solid #e5e7eb;font-size:0.78rem;color:#9ca3af;text-align:center">
          <p>You're receiving this because you subscribed to ${storeName} updates.<br>
          <a href="${unsubscribeUrl}" style="color:#9ca3af">Unsubscribe here</a></p>
        </div>
      </div>
    `,
  });
};

const sendNewsletterEmail = async (to, { subject, bodyHtml, bodyText, unsubscribeUrl, storeName }) => {
  if (!isConfigured() || !to) return;
  const store = storeName || process.env.STORE_NAME || 'BodyCreamGH';
  const footer = unsubscribeUrl
    ? `<div style="margin-top:40px;padding-top:20px;border-top:1px solid #e5e7eb;font-size:0.78rem;color:#9ca3af;text-align:center">
         <p>You're receiving this because you subscribed to ${store} updates.<br>
         <a href="${unsubscribeUrl}" style="color:#9ca3af">Unsubscribe here</a></p>
       </div>`
    : `<div style="margin-top:40px;padding-top:20px;border-top:1px solid #e5e7eb;font-size:0.78rem;color:#9ca3af;text-align:center">
         <p>You're receiving this because you have an account with ${store}.</p>
       </div>`;

  await getTransporter().sendMail({
    from: `${store} <${process.env.SMTP_USER}>`,
    to,
    subject,
    html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">${bodyHtml}${footer}</div>`,
    ...(bodyText ? { text: `${bodyText}\n\n---\n${unsubscribeUrl ? `Unsubscribe: ${unsubscribeUrl}` : ''}` } : {}),
  });
};

// ── Admin OTP (MFA) ───────────────────────────────────────────────────────────

const sendOtpEmail = async (to, { firstName, otp }) => {
  if (!isConfigured() || !to) return;
  await getTransporter().sendMail({
    from: `Cosmetics Store <${process.env.SMTP_USER}>`,
    to,
    subject: 'Your admin login verification code',
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <h2>Admin Login Verification</h2>
      ${firstName ? `<p>Hi ${firstName},</p>` : ''}
      <p>Your one-time login code is:</p>
      <p style="font-size:2rem;font-weight:700;letter-spacing:0.2em;color:#1c1410;margin:20px 0">${otp}</p>
      <p>This code expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
      <p style="color:#888;font-size:0.85rem">If you did not attempt to log in, please change your password immediately.</p>
    </div>`,
  });
};

module.exports = {
  verifyTransporter,
  sendOrderConfirmation, sendWelcomeEmail, sendShippingNotification,
  sendPasswordResetEmail, sendReviewRequest, sendOrderCancellation, sendRefundNotification,
  sendCancelRequested, sendCancelRejected, sendReturnRequested, sendReturnRejected,
  sendAdminNewOrder, sendAdminCancelRequest, sendAdminCancelRejected,
  sendAdminReturnRequest, sendAdminReturnRejected,
  sendAdminOrderCancelled, sendAdminOrderRefunded, sendAdminOrderShipped, sendAdminOrderDelivered,
  sendOtpEmail,
  sendNewsletterWelcome, sendNewsletterEmail,
};

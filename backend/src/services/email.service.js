const nodemailer = require('nodemailer');

// Single transporter instance reused across all sends.
// Env-configurable for Gmail, AWS SES, Resend, Brevo, or any SMTP provider:
//   SMTP_HOST, SMTP_PORT (default 587), SMTP_SECURE ('true' for port 465),
//   SMTP_REQUIRE_TLS (default 'true' when not secure), SMTP_USER, SMTP_PASS,
//   EMAIL_FROM (e.g. "BodyCream GH <orders@yourdomain.com>"; required for SES/Resend/Brevo
//   where SMTP_USER is an API key or IAM username rather than a From address).
let _transporter = null;
function getFromAddress() {
  const configured = (process.env.EMAIL_FROM || '').trim();
  if (configured) return configured;
  return `BodyCream GH <${(process.env.SMTP_USER || '').trim()}>`;
}

function getTransporter() {
  if (!_transporter) {
    const port = parseInt(process.env.SMTP_PORT, 10) || 587;
    const secure = process.env.SMTP_SECURE === 'true' || port === 465;
    const requireTLS = process.env.SMTP_REQUIRE_TLS !== 'false' && !secure;
    _transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure,
      requireTLS,
      auth: {
        user: (process.env.SMTP_USER || '').trim(),
        pass: (process.env.SMTP_PASS || '').replace(/\s+/g, ''),
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

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));

const sendOrderConfirmation = async (to, { orderNumber, total, items = [] }) => {
  if (!isConfigured() || !to) return;

  const itemRows = items
    .map(i => `<tr><td>${escapeHtml(i.name)}</td><td>${escapeHtml(i.quantity)}</td><td>GHS ${parseFloat(i.price_at_purchase).toFixed(2)}</td></tr>`)
    .join('');

  await getTransporter().sendMail({
    from: getFromAddress(),
    to,
    subject: `Order Confirmed – ${orderNumber}`,
    html: `
      <h2>Thank you for your order!</h2>
      <p>Order number: <strong>${escapeHtml(orderNumber)}</strong></p>
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
    from: getFromAddress(),
    to,
    subject: 'Welcome to our store!',
    html: `<h2>Welcome${firstName ? `, ${escapeHtml(firstName)}` : ''}!</h2>
           <p>Your account has been created. Start shopping today!</p>`,
  });
};

const sendShippingNotification = async (to, { orderNumber, trackingNumber, deliveryPartner }) => {
  if (!isConfigured() || !to) return;

  await getTransporter().sendMail({
    from: getFromAddress(),
    to,
    subject: `Your order ${orderNumber} has shipped!`,
    html: `
      <h2>Your order is on its way!</h2>
      <p>Order: <strong>${escapeHtml(orderNumber)}</strong></p>
      ${deliveryPartner ? `<p>Delivery partner: ${escapeHtml(deliveryPartner)}</p>` : ''}
      ${trackingNumber ? `<p>Tracking number: <strong>${escapeHtml(trackingNumber)}</strong></p>` : ''}
    `,
  });
};

const sendPasswordResetEmail = async (to, resetUrl, token = null) => {
  if (!isConfigured() || !to) return;

  let extractedToken = token;
  if (!extractedToken && resetUrl) {
    try {
      extractedToken = new URL(resetUrl).searchParams.get('token');
    } catch (_) {}
  }

  await getTransporter().sendMail({
    from: getFromAddress(),
    to,
    subject: extractedToken ? `Your password reset code: ${extractedToken}` : 'Reset your password',
    html: `
      <h2>Password Reset Request</h2>
      ${extractedToken ? `
        <p>Enter this <strong>6-digit verification code</strong> in the app to reset your password:</p>
        <div style="font-family:monospace;font-size:30px;font-weight:700;letter-spacing:8px;background:#faf7f4;border:1px solid #ede5db;padding:16px 20px;border-radius:8px;text-align:center;color:#1c1410;margin:16px 0;">
          ${escapeHtml(extractedToken)}
        </div>
      ` : ''}
      <p>Or reset on the web using the button below:</p>
      <p>
        <a href="${resetUrl}" style="background:#1c1410;color:#fff;padding:12px 24px;border-radius:4px;text-decoration:none;display:inline-block;">
          Reset Password
        </a>
      </p>
      <p>This code expires in <strong>15 minutes</strong>.</p>
      <p>If you did not request a password reset, you can safely ignore this email.</p>
    `,
  });
};

const sendReviewRequest = async (to, { customerName, orderNumber, orderId, items = [], frontendUrl }) => {
  if (!isConfigured() || !to) return;

  const url = (frontendUrl || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
  const targetUrl = orderId ? `${url}/orders/${orderId}?review=1` : `${url}/orders`;
  const itemList = items
    .map(i => `
      <li style="margin-bottom:12px;list-style:none;padding:12px 16px;background:#faf7f4;border-radius:6px;border:1px solid #ede5db;display:flex;align-items:center;justify-content:space-between;">
        <div>
          <strong style="color:#1c1410;font-size:15px;display:block;">${escapeHtml(i.name || i.product_name)}</strong>
          <span style="color:#7a6e68;font-size:12px;">Verified Purchase</span>
        </div>
        <a href="${url}/orders/${orderId || ''}?product=${i.product_id || i.id}&review=1" style="color:#a8863d;font-weight:600;font-size:13px;text-decoration:none;padding:6px 12px;background:#fff;border:1px solid #c9a55a;border-radius:4px;white-space:nowrap;">
          Review Item →
        </a>
      </li>
    `)
    .join('');

  await getTransporter().sendMail({
    from: getFromAddress(),
    to,
    subject: `Your order #${orderNumber} has arrived — how did we do?`,
    html: `
      <div style="font-family:'Inter',system-ui,-apple-system,sans-serif;max-width:580px;margin:0 auto;color:#1c1410;padding:24px 16px;">
        <h2 style="font-family:Georgia,serif;font-size:24px;color:#1c1410;margin-bottom:8px;">Your order has been delivered! 🎉</h2>
        ${customerName ? `<p style="font-size:15px;color:#7a6e68;">Hi ${escapeHtml(customerName)},</p>` : ''}
        <p style="font-size:15px;line-height:1.6;color:#332924;">
          We hope you are loving your handcrafted skincare! As a verified buyer, your honest feedback helps other shoppers and helps our cooperatives continuously refine our batches.
        </p>
        <p style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#a8863d;margin-top:24px;margin-bottom:12px;">
          Review the products you received:
        </p>
        <ul style="padding:0;margin:0;">${itemList}</ul>
        <div style="margin-top:32px;text-align:center;">
          <a href="${targetUrl}" style="background:#c9a55a;color:#ffffff;padding:14px 32px;border-radius:9999px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.05em;display:inline-block;">
            Review Your Order
          </a>
        </div>
        <p style="margin-top:14px;color:#7a6e68;font-size:13px;text-align:center;">
          Using the BodyCream GH app? Open the app → <strong>Orders</strong> → tap <strong>#${escapeHtml(orderNumber)}</strong> to rate your items directly.
        </p>
        <p style="margin-top:28px;color:#a89f91;font-size:12px;text-align:center;">Order #${escapeHtml(orderNumber)} · Handcrafted with love in Ghana</p>
      </div>
    `,
  });
};

const sendOrderCancellation = async (to, { customerName, orderNumber }) => {
  if (!isConfigured() || !to) return;

  await getTransporter().sendMail({
    from: getFromAddress(),
    to,
    subject: `Your order ${orderNumber} has been cancelled`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
        <h2>Order Cancelled</h2>
        ${customerName ? `<p>Hi ${escapeHtml(customerName)},</p>` : ''}
        <p>Your order <strong>${escapeHtml(orderNumber)}</strong> has been cancelled.</p>
        <p>If you did not request this cancellation or have any questions, please contact our support team.</p>
      </div>
    `,
  });
};

const sendRefundNotification = async (to, { customerName, orderNumber, total }) => {
  if (!isConfigured() || !to) return;

  await getTransporter().sendMail({
    from: getFromAddress(),
    to,
    subject: `Refund processed for order ${orderNumber}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
        <h2>Refund Processed</h2>
        ${customerName ? `<p>Hi ${escapeHtml(customerName)},</p>` : ''}
        <p>A refund of <strong>GHS ${parseFloat(total).toFixed(2)}</strong> has been processed for order <strong>${escapeHtml(orderNumber)}</strong>.</p>
        <p>Please allow 5-10 business days for the amount to reflect in your account.</p>
      </div>
    `,
  });
};

// ── Customer: cancel / return request confirmations ──────────────────────────

const sendCancelRequested = async (to, { customerName, orderNumber }) => {
  if (!isConfigured() || !to) return;
  await getTransporter().sendMail({
    from: getFromAddress(),
    to,
    subject: `Cancellation request received for order ${orderNumber}`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <h2>Cancellation Request Received</h2>
      ${customerName ? `<p>Hi ${escapeHtml(customerName)},</p>` : ''}
      <p>We received your cancellation request for order <strong>${escapeHtml(orderNumber)}</strong>.</p>
      <p>Our team will review it shortly and notify you of the outcome.</p>
    </div>`,
  });
};

const sendCancelRejected = async (to, { customerName, orderNumber }) => {
  if (!isConfigured() || !to) return;
  await getTransporter().sendMail({
    from: getFromAddress(),
    to,
    subject: `Cancellation request not approved — order ${orderNumber}`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <h2>Cancellation Request Not Approved</h2>
      ${customerName ? `<p>Hi ${escapeHtml(customerName)},</p>` : ''}
      <p>Unfortunately, your cancellation request for order <strong>${escapeHtml(orderNumber)}</strong> could not be approved at this time.</p>
      <p>If you have questions, please contact our support team.</p>
    </div>`,
  });
};

const sendReturnRequested = async (to, { customerName, orderNumber }) => {
  if (!isConfigured() || !to) return;
  await getTransporter().sendMail({
    from: getFromAddress(),
    to,
    subject: `Return request received for order ${orderNumber}`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <h2>Return Request Received</h2>
      ${customerName ? `<p>Hi ${escapeHtml(customerName)},</p>` : ''}
      <p>We received your return request for order <strong>${escapeHtml(orderNumber)}</strong>.</p>
      <p>Our team will review it and get back to you. If approved, a refund will be processed.</p>
    </div>`,
  });
};

const sendReturnRejected = async (to, { customerName, orderNumber }) => {
  if (!isConfigured() || !to) return;
  await getTransporter().sendMail({
    from: getFromAddress(),
    to,
    subject: `Return request not approved — order ${orderNumber}`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <h2>Return Request Not Approved</h2>
      ${customerName ? `<p>Hi ${escapeHtml(customerName)},</p>` : ''}
      <p>Unfortunately, your return request for order <strong>${escapeHtml(orderNumber)}</strong> could not be approved at this time.</p>
      <p>If you have questions, please contact our support team.</p>
    </div>`,
  });
};

// ── Admin alert emails ────────────────────────────────────────────────────────

const sendAdminNewOrder = async (to, { orderNumber, total, customerName }) => {
  if (!isConfigured() || !to) return;
  await getTransporter().sendMail({
    from: getFromAddress(),
    to,
    subject: `New order received — ${orderNumber}`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <h2>New Order Received</h2>
      <p>Order <strong>${escapeHtml(orderNumber)}</strong> has been paid and confirmed.</p>
      <p>Customer: ${escapeHtml(customerName || 'Guest')}</p>
      <p>Total: <strong>GHS ${parseFloat(total).toFixed(2)}</strong></p>
    </div>`,
  });
};

const sendAdminCancelRequest = async (to, { orderNumber, customerName, reason }) => {
  if (!isConfigured() || !to) return;
  await getTransporter().sendMail({
    from: getFromAddress(),
    to,
    subject: `Action needed: cancellation request for order ${orderNumber}`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <h2>Cancellation Request — Action Required</h2>
      <p>Customer <strong>${escapeHtml(customerName || 'Guest')}</strong> has requested cancellation for order <strong>${escapeHtml(orderNumber)}</strong>.</p>
      ${reason ? `<p>Reason: ${escapeHtml(reason)}</p>` : ''}
      <p>Please review and approve or reject the request in the admin panel.</p>
    </div>`,
  });
};

const sendAdminCancelRejected = async (to, { orderNumber }) => {
  if (!isConfigured() || !to) return;
  await getTransporter().sendMail({
    from: getFromAddress(),
    to,
    subject: `Cancellation request rejected — order ${orderNumber}`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <h2>Cancellation Request Rejected</h2>
      <p>The cancellation request for order <strong>${escapeHtml(orderNumber)}</strong> has been rejected.</p>
      <p>The customer has been notified.</p>
    </div>`,
  });
};

const sendAdminReturnRequest = async (to, { orderNumber, customerName, reason }) => {
  if (!isConfigured() || !to) return;
  await getTransporter().sendMail({
    from: getFromAddress(),
    to,
    subject: `Action needed: return request for order ${orderNumber}`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <h2>Return Request — Action Required</h2>
      <p>Customer <strong>${escapeHtml(customerName || 'Guest')}</strong> has requested a return for order <strong>${escapeHtml(orderNumber)}</strong>.</p>
      ${reason ? `<p>Reason: ${escapeHtml(reason)}</p>` : ''}
      <p>Please review and approve or reject the request in the admin panel.</p>
    </div>`,
  });
};

const sendAdminReturnRejected = async (to, { orderNumber }) => {
  if (!isConfigured() || !to) return;
  await getTransporter().sendMail({
    from: getFromAddress(),
    to,
    subject: `Return request rejected — order ${orderNumber}`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <h2>Return Request Rejected</h2>
      <p>The return request for order <strong>${escapeHtml(orderNumber)}</strong> has been rejected.</p>
      <p>The customer has been notified.</p>
    </div>`,
  });
};

const sendAdminOrderCancelled = async (to, { orderNumber }) => {
  if (!isConfigured() || !to) return;
  await getTransporter().sendMail({
    from: getFromAddress(),
    to,
    subject: `Order cancelled — ${orderNumber}`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <h2>Order Cancelled</h2>
      <p>Order <strong>${escapeHtml(orderNumber)}</strong> has been cancelled. Stock has been restored.</p>
    </div>`,
  });
};

const sendAdminOrderRefunded = async (to, { orderNumber, total }) => {
  if (!isConfigured() || !to) return;
  await getTransporter().sendMail({
    from: getFromAddress(),
    to,
    subject: `Refund processed — order ${orderNumber}`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <h2>Refund Processed</h2>
      <p>A refund of <strong>GHS ${parseFloat(total).toFixed(2)}</strong> has been processed for order <strong>${escapeHtml(orderNumber)}</strong>.</p>
    </div>`,
  });
};

const sendAdminOrderShipped = async (to, { orderNumber, trackingNumber }) => {
  if (!isConfigured() || !to) return;
  await getTransporter().sendMail({
    from: getFromAddress(),
    to,
    subject: `Order shipped — ${orderNumber}`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <h2>Order Shipped</h2>
      <p>Order <strong>${escapeHtml(orderNumber)}</strong> has been shipped.</p>
      ${trackingNumber ? `<p>Tracking number: <strong>${escapeHtml(trackingNumber)}</strong></p>` : ''}
    </div>`,
  });
};

const sendAdminOrderDelivered = async (to, { orderNumber }) => {
  if (!isConfigured() || !to) return;
  await getTransporter().sendMail({
    from: getFromAddress(),
    to,
    subject: `Order delivered — ${orderNumber}`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <h2>Order Delivered</h2>
      <p>Order <strong>${escapeHtml(orderNumber)}</strong> has been marked as delivered.</p>
    </div>`,
  });
};

// ── Newsletter emails ─────────────────────────────────────────────────────────

const sendNewsletterWelcome = async (to, { name, unsubscribeUrl, discountText = '10% off', couponCode = 'WELCOME10' }) => {
  if (!isConfigured() || !to) return;
  const storeName = process.env.STORE_NAME || 'BodyCreamGH';
  await getTransporter().sendMail({
    from: `${storeName} <${process.env.SMTP_USER}>`,
    to,
    subject: `You're in! Here's your ${discountText} coupon code`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#ffffff;border:1px solid #f0ebe4;border-radius:12px">
        <h2 style="font-size:24px;margin-bottom:8px;color:#1c1410">You're officially on the list! 🎉</h2>
        ${name ? `<p style="color:#4b5563">Hi ${escapeHtml(name)},</p>` : ''}
        <p style="color:#4b5563;font-size:15px;line-height:1.6">Welcome to the <strong>${escapeHtml(storeName)}</strong> family. As a special thank-you for joining us, enjoy <strong>${escapeHtml(discountText)}</strong> on your next order.</p>

        ${couponCode ? `
        <div style="margin:24px 0;padding:20px;background:#faf6ee;border:2px dashed #c9a55a;border-radius:10px;text-align:center">
          <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#8b6b23">Your Exclusive Welcome Code</p>
          <div style="font-size:26px;font-weight:800;letter-spacing:0.15em;color:#1c1410;font-family:monospace">${escapeHtml(couponCode)}</div>
          <p style="margin:8px 0 0;font-size:13px;color:#6b7280">Enter this code at checkout to claim your ${escapeHtml(discountText)}.</p>
        </div>
        ` : ''}

        <p style="margin-top:20px;color:#4b5563;font-size:15px;line-height:1.6">Expect subscriber-only offers, botanical skincare tips, and first access to our limited-batch releases — straight to your inbox.</p>
        <div style="margin-top:40px;padding-top:20px;border-top:1px solid #e5e7eb;font-size:0.78rem;color:#9ca3af;text-align:center">
          <p>You're receiving this because you subscribed to ${escapeHtml(storeName)} updates.<br>
          <a href="${unsubscribeUrl}" style="color:#9ca3af;text-decoration:underline">Unsubscribe here</a></p>
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
         <p>You're receiving this because you subscribed to ${escapeHtml(store)} updates.<br>
         <a href="${unsubscribeUrl}" style="color:#9ca3af">Unsubscribe here</a></p>
       </div>`
    : `<div style="margin-top:40px;padding-top:20px;border-top:1px solid #e5e7eb;font-size:0.78rem;color:#9ca3af;text-align:center">
         <p>You're receiving this because you have an account with ${escapeHtml(store)}.</p>
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
    from: getFromAddress(),
    to,
    subject: 'Your admin login verification code',
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <h2>Admin Login Verification</h2>
      ${firstName ? `<p>Hi ${escapeHtml(firstName)},</p>` : ''}
      <p>Your one-time login code is:</p>
      <p style="font-size:2rem;font-weight:700;letter-spacing:0.2em;color:#1c1410;margin:20px 0">${escapeHtml(otp)}</p>
      <p>This code expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
      <p style="color:#888;font-size:0.85rem">If you did not attempt to log in, please change your password immediately.</p>
    </div>`,
  });
};

const sendAdminPaymentAlert = async (to, { orderNumber, title, detail }) => {
  if (!isConfigured() || !to) return;
  await getTransporter().sendMail({
    from: getFromAddress(),
    to,
    subject: `[Payment Alert] ${title} — order ${orderNumber}`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <h2>${escapeHtml(title)}</h2>
      <p><strong>Order:</strong> ${escapeHtml(orderNumber)}</p>
      ${detail ? `<p>${escapeHtml(detail)}</p>` : ''}
      <p style="color:#666;font-size:0.85rem">Please review this order in the Admin Dashboard.</p>
    </div>`,
  });
};

const sendOrderStatusUpdate = async (
  to,
  { customerName, orderNumber, status, fulfillmentMethod, pickupLocation, pickupHours, note }
) => {
  if (!isConfigured() || !to) return;
  const isPickup = fulfillmentMethod === 'pickup';

  let subject;
  let heading;
  let bodyText;

  switch (status) {
    case 'confirmed':
      subject = `Order ${orderNumber} Confirmed`;
      heading = 'Your order has been confirmed!';
      bodyText = isPickup
        ? 'We have confirmed your pickup order and will let you know as soon as it is packed and ready.'
        : 'We have confirmed your order and are getting it ready for dispatch.';
      break;
    case 'processing':
      subject = `Order ${orderNumber} is Being Packed`;
      heading = 'Your order is being packaged!';
      bodyText = isPickup
        ? 'Our team is carefully packing your items at our pickup station. We will notify you as soon as it is ready for collection.'
        : 'Our team is carefully packing your items for shipment. We will notify you as soon as it is dispatched.';
      break;
    case 'shipped':
      subject = isPickup
        ? `Order ${orderNumber} is Ready for Pickup!`
        : `Order ${orderNumber} Has Shipped!`;
      heading = isPickup ? 'Your order is ready for pickup!' : 'Your order is on its way!';
      bodyText = isPickup
        ? 'Your package is packed and waiting for you at our pickup station.'
        : 'Your package has been handed over for delivery and is on its way to you.';
      break;
    case 'delivered':
      subject = isPickup
        ? `Order ${orderNumber} Picked Up — Thank You!`
        : `Order ${orderNumber} Delivered — Thank You!`;
      heading = isPickup ? 'Order collected — thank you!' : 'Your order has been delivered!';
      bodyText = isPickup
        ? 'Your order has been marked as picked up. We hope you love your products!'
        : 'Your order has been marked as delivered. We hope you love your products!';
      break;
    default:
      return;
  }

  const pickupBlock = isPickup && (status === 'shipped' || status === 'processing' || status === 'confirmed') && pickupLocation
    ? `<div style="background:#faf7f4;border:1px solid #ede5db;border-radius:8px;padding:12px 16px;margin:16px 0;">
         <p style="margin:0 0 4px 0;font-weight:700;color:#1c1410;">Pickup Station</p>
         <p style="margin:0;color:#1c1410;">${escapeHtml(pickupLocation)}</p>
         ${pickupHours ? `<p style="margin:4px 0 0 0;font-size:13px;color:#7a6e68;">Hours: ${escapeHtml(pickupHours)}</p>` : ''}
       </div>`
    : '';

  await getTransporter().sendMail({
    from: getFromAddress(),
    to,
    subject,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1c1410;">
      <h2>${escapeHtml(heading)}</h2>
      <p>Hi ${escapeHtml(customerName || 'Valued Customer')},</p>
      <p>${escapeHtml(bodyText)}</p>
      <p><strong>Order Number:</strong> ${escapeHtml(orderNumber)}</p>
      ${pickupBlock}
      ${note && !/^Manual update by admin$|^Status changed to /i.test(note) ? `<p style="color:#555;"><em>Note: ${escapeHtml(note)}</em></p>` : ''}
      <p style="margin-top:20px;color:#7a6e68;font-size:13px;">Thank you for shopping with BodyCream GH.</p>
    </div>`,
  });
};

const sendReturnApproved = async (to, { customerName, orderNumber, refundAmount, items = [] }) => {
  if (!isConfigured() || !to) return;
  const rows = (items || [])
    .map(i => `<li>${escapeHtml(i.product_name || i.name || 'Item')}${i.variant_label ? ` (${escapeHtml(i.variant_label)})` : ''} &times; ${Number(i.quantity || 1)} — GHS ${Number(i.line_refund_amount || 0).toFixed(2)}</li>`)
    .join('');
  await getTransporter().sendMail({
    from: getFromAddress(),
    to,
    subject: `Return approved — ${orderNumber}`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <h2>Return Approved</h2>
      <p>Hi ${escapeHtml(customerName || 'Customer')},</p>
      <p>Your return request for order <strong>${escapeHtml(orderNumber)}</strong> has been approved.</p>
      ${rows ? `<ul>${rows}</ul>` : ''}
      <p><strong>Refund amount:</strong> GHS ${Number(refundAmount || 0).toFixed(2)}</p>
      <p style="color:#666;font-size:0.9em">Your refund is being processed and you will receive a confirmation once settled.</p>
    </div>`,
  });
};

const sendPartialRefundCompleted = async (to, { customerName, orderNumber, refundAmount, refundReference }) => {
  if (!isConfigured() || !to) return;
  await getTransporter().sendMail({
    from: getFromAddress(),
    to,
    subject: `Refund processed — ${orderNumber}`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <h2>Partial Refund Processed</h2>
      <p>Hi ${escapeHtml(customerName || 'Customer')},</p>
      <p>Your refund of <strong>GHS ${Number(refundAmount || 0).toFixed(2)}</strong> for order <strong>${escapeHtml(orderNumber)}</strong> has been processed.</p>
      ${refundReference ? `<p style="color:#666;font-size:0.9em">Reference: ${escapeHtml(refundReference)}</p>` : ''}
    </div>`,
  });
};

module.exports = {
  escapeHtml,
  verifyTransporter,
  sendOrderConfirmation, sendOrderStatusUpdate, sendWelcomeEmail, sendShippingNotification,
  sendPasswordResetEmail, sendReviewRequest, sendOrderCancellation, sendRefundNotification,
  sendCancelRequested, sendCancelRejected, sendReturnRequested, sendReturnRejected,
  sendReturnApproved, sendPartialRefundCompleted,
  sendAdminNewOrder, sendAdminCancelRequest, sendAdminCancelRejected,
  sendAdminReturnRequest, sendAdminReturnRejected,
  sendAdminOrderCancelled, sendAdminOrderRefunded, sendAdminOrderShipped, sendAdminOrderDelivered,
  sendAdminPaymentAlert,
  sendOtpEmail,
  sendNewsletterWelcome, sendNewsletterEmail,
};

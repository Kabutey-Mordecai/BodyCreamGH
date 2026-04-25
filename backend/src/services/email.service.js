const nodemailer = require('nodemailer');

const getTransporter = () =>
  nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

const isConfigured = () => Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);

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

module.exports = { sendOrderConfirmation, sendWelcomeEmail, sendShippingNotification, sendPasswordResetEmail, sendReviewRequest };

'use strict';

require('dotenv').config();
require('./config/env'); // fail-fast production env validation — must be first

const path       = require('path');
const fs         = require('fs');
const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const bodyParser = require('body-parser');
const errorHandler        = require('./middleware/errorHandler');
const { makeRateLimiter } = require('./middleware/rateLimit');
const logger              = require('./utils/logger');
const pool                = require('./config/database');

// Ensure the product upload directory exists before any request is handled.
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'products');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const authRoutes      = require('./routes/auth');
const productRoutes   = require('./routes/products');
const cartRoutes      = require('./routes/cart');
const orderRoutes     = require('./routes/orders');
const paymentRoutes   = require('./routes/payments');
const adminRoutes     = require('./routes/admin');
const inventoryRoutes = require('./routes/inventory');
const customerRoutes  = require('./routes/customers');
const deliveryRoutes  = require('./routes/deliveries');
const settingsRoutes  = require('./routes/settings');
const wishlistRoutes  = require('./routes/wishlist');
const couponRoutes       = require('./routes/coupons');
const newsletterRoutes   = require('./routes/newsletter');
const promotionRoutes    = require('./routes/promotions');

const app = express();

// ── Reverse-proxy hop count ──────────────────────────────────────────────────
// Production runs behind 1 Nginx reverse proxy hop (deploy/nginx.*.conf).
// Only numeric hop counts are accepted — never "true" (which allows XFF spoofing).
function resolveTrustProxy() {
  const raw = process.env.TRUST_PROXY;
  if (raw !== undefined && raw !== '') {
    if (/^\d+$/.test(String(raw).trim())) {
      return parseInt(String(raw).trim(), 10);
    }
    logger.warn('Ignoring non-numeric TRUST_PROXY value; using safe default');
  }
  return process.env.NODE_ENV === 'production' ? 1 : 0;
}
app.set('trust proxy', resolveTrustProxy());

// ── Security headers (helmet) ─────────────────────────────────────────────────
// Mounted first so every response — including CORS rejections, rate-limit 429s,
// and unhandled errors — carries the full set of security headers.
// Nginx duplicates some of these in production; the redundancy is intentional
// (defense in depth for bare-Node and Docker setups without Nginx).
app.use(helmet({
  // Lock down CSP for an API that never serves browser-executed HTML.
  // The React frontend (Netlify) manages its own CSP entirely separately.
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'none'"],
      imgSrc:         ["'self'"],
      scriptSrc:      ["'none'"],
      objectSrc:      ["'none'"],
      frameAncestors: ["'none'"],
      baseUri:        ["'none'"],
      formAction:     ["'none'"],
    },
  },
  // Deny embedding this API in frames or iframes.
  frameguard: { action: 'deny' },
  // The frontend is on a different origin and fetches product images from /uploads.
  // cross-origin allows those fetches to succeed without a CORS preflight.
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  // HSTS: 1 year. Nginx also sets this in production; this covers bare-Node setups.
  strictTransportSecurity: {
    maxAge: 31_536_000,
    includeSubDomains: true,
  },
  // Match Nginx's Referrer-Policy for consistency.
  referrerPolicy: { policy: 'strict-origin' },
}));

// Production: ALLOWED_ORIGINS must be set — wildcard is rejected.
// Development: falls back to permissive wildcard if unset.
const _rawOrigins = process.env.ALLOWED_ORIGINS;
if (!_rawOrigins && process.env.NODE_ENV === 'production') {
  process.stderr.write('[FATAL] ALLOWED_ORIGINS must be set in production. Refusing to start.\n');
  process.exit(1);
}
const _corsOrigin = _rawOrigins
  ? _rawOrigins.split(',').map(o => o.trim()).filter(Boolean)
  : '*';

app.use(cors({
  origin: _corsOrigin,
  credentials: true,
}));

// Capture raw body so Paystack webhook HMAC signature can be verified.
// Must run before the webhook route below.
app.use(bodyParser.json({
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
app.use(bodyParser.urlencoded({ extended: true }));

// Static files — Nginx should handle /uploads in production.
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ── Paystack webhook — mounted BEFORE rate limiters ──────────────────────────
// The HMAC signature check inside handleWebhook is the security gate.
// Rate-limiting Paystack's server IP would cause retries to be silently dropped.
// Express resolves this route first; the request never reaches the limiters below.
const { handleWebhook } = require('./controllers/payment.controller');
app.post('/api/payments/webhook', handleWebhook);

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Auth endpoint limiters (login, register, verify-otp, refresh, logout, password reset)
// are mounted directly inside routes/auth.js to avoid double-counting.
app.use('/api/payments', makeRateLimiter(60 * 1000, 30,  'Too many payment requests'));
app.use('/api',          makeRateLimiter(60 * 1000, 200, 'Rate limit exceeded'));

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth',       authRoutes);
app.use('/api/products',   productRoutes);
app.use('/api/cart',       cartRoutes);
app.use('/api/orders',     orderRoutes);
app.use('/api/payments',   paymentRoutes);
app.use('/api/admin',      adminRoutes);
app.use('/api/inventory',  inventoryRoutes);
app.use('/api/customers',  customerRoutes);
app.use('/api/deliveries', deliveryRoutes);
app.use('/api/settings',   settingsRoutes);
app.use('/api/wishlist',   wishlistRoutes);
app.use('/api/coupons',     couponRoutes);
app.use('/api/newsletter',  newsletterRoutes);
app.use('/api/promotions', promotionRoutes);

app.get('/api/health', async (_req, res) => {
  let dbStatus = 'ok';
  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 2000)
      ),
    ]);
  } catch (err) {
    dbStatus = 'error';
    logger.error('Health check: DB ping failed', { err: err.message });
  }
  res.status(dbStatus === 'ok' ? 200 : 503).json({
    status:    dbStatus === 'ok' ? 'ok' : 'degraded',
    database:  dbStatus,
    uptime:    Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.use(errorHandler);

// ── Startup ───────────────────────────────────────────────────────────────────
async function bootstrapAdmin(db) {
  const email    = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;

  const { rows } = await db.query('SELECT id FROM users WHERE email = $1', [email]);
  if (rows.length) return;

  const bcrypt = require('bcryptjs');
  const { randomUUID: uuid } = require('crypto');
  const hash = await bcrypt.hash(password, 12);
  await db.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, created_at, updated_at)
     VALUES ($1, $2, $3, 'Admin', 'User', 'admin', NOW(), NOW())`,
    [uuid(), email, hash]
  );
  logger.info('Admin user created', { email });
}

async function start() {
  const db = require('./config/database');

  await db
    .query('DELETE FROM token_blacklist WHERE expires_at < NOW()')
    .catch(err => logger.error('Token blacklist cleanup error', { err: err.message }));

  await bootstrapAdmin(db).catch(err => logger.error('Admin bootstrap error', { err: err.message }));

  const { verifyTransporter } = require('./services/email.service');
  await verifyTransporter().catch(() => {}); // errors already logged inside verifyTransporter

  // Start the producer-only pg-boss instance so controllers can enqueue jobs via
  // boss.send(). Maintenance, scheduling, and migrations are all disabled here —
  // those belong to worker.js which owns the full pg-boss lifecycle.
  const boss = require('./config/pgboss-producer');
  await boss.start();
  logger.info('pg-boss producer started');

  // Workers (pg-boss, queues, reconciliation) run in a separate process defined
  // in src/worker.js. Do not start them here — cluster mode would launch one
  // pg-boss instance per CPU, wasting connection-pool slots unnecessarily.

  const PORT = process.env.PORT || 3000;
  const httpServer = app.listen(PORT, () =>
    logger.info(`Web server running on http://localhost:${PORT}`)
  );

  // ── Graceful shutdown ───────────────────────────────────────────────────────
  // PM2 sends SIGTERM before reloading or stopping. Stop accepting new connections,
  // wait for in-flight requests to drain, then close the DB pool.
  async function shutdown(signal) {
    logger.info(`${signal} received — shutting down web server`);
    httpServer.close(async () => {
      await boss.stop({ graceful: false })
        .catch(err => logger.error('pg-boss producer stop error', { err: err.message }));
      await db.end().catch(err => logger.error('DB pool close error', { err: err.message }));
      logger.info('Web server stopped');
      process.exit(0);
    });
    // Force-exit if requests haven't drained within 10 s.
    setTimeout(() => {
      logger.error('Graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, 10_000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

start().catch(err => {
  logger.error('Server failed to start', { err: err.message });
  process.exit(1);
});

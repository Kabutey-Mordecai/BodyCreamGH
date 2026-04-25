require('dotenv').config();

const path       = require('path');
const fs         = require('fs');
const express    = require('express');
const cors       = require('cors');
const bodyParser = require('body-parser');
const errorHandler        = require('./middleware/errorHandler');
const { makeRateLimiter } = require('./middleware/rateLimit');
const logger              = require('./utils/logger');

// Ensure the product upload directory exists before any request is handled.
// memoryStorage uploads are written here by the image controller.
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
const couponRoutes    = require('./routes/coupons');

const app = express();

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  credentials: true,
}));

// Capture raw body so Paystack webhook HMAC signature can be verified
app.use(bodyParser.json({
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
app.use(bodyParser.urlencoded({ extended: true }));

// ── Static files — served before API routes, no auth middleware involved ─────
// In production, Nginx should handle /uploads directly via an alias to the
// Docker volume; Express static is the fallback for dev and bare-Node deploys.
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ── Rate limiting ────────────────────────────────────────────────────────────
app.use('/api/auth/login',    makeRateLimiter(15 * 60 * 1000, 10,  'Too many login attempts'));
app.use('/api/auth/register', makeRateLimiter(60 * 60 * 1000, 5,   'Too many registration attempts'));
app.use('/api/payments',      makeRateLimiter(60 * 1000,       30,  'Too many payment requests'));
app.use('/api',               makeRateLimiter(60 * 1000,       200, 'Rate limit exceeded'));

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
app.use('/api/coupons',    couponRoutes);

app.get('/api/health', (_req, res) => res.json({ status: 'OK', timestamp: new Date().toISOString() }));

app.use(errorHandler);

// ── Async startup ────────────────────────────────────────────────────────────
async function bootstrapAdmin(db) {
  const email    = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;

  const { rows } = await db.query('SELECT id FROM users WHERE email = $1', [email]);
  if (rows.length) return; // already exists

  const bcrypt = require('bcryptjs');
  const { v4: uuid } = require('uuid');
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

  // Purge stale token blacklist entries
  await db
    .query('DELETE FROM token_blacklist WHERE expires_at < NOW()')
    .catch(err => logger.error('Token blacklist cleanup error', { err: err.message }));

  // Bootstrap admin user if not yet created
  await bootstrapAdmin(db).catch(err => logger.error('Admin bootstrap error', { err: err.message }));

  // Start pg-boss (runs its own DB migrations on first boot)
  const boss = require('./config/pgboss');
  await boss.start();
  logger.info('pg-boss started');

  // Register all workers
  await require('./workers/payment.worker')(boss);
  await require('./workers/shipment.worker')(boss);
  await require('./workers/notification.worker')(boss);
  await require('./workers/reconciliation.worker')(boss);

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => logger.info(`Server running on http://localhost:${PORT}`));
}

start().catch(err => {
  logger.error('Server failed to start', { err: err.message });
  process.exit(1);
});

require('dotenv').config();
require('./events'); // bootstrap all EventEmitter handlers
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const errorHandler = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const cartRoutes = require('./routes/cart');
const orderRoutes = require('./routes/orders');
const paymentRoutes = require('./routes/payments');
const adminRoutes = require('./routes/admin');
const inventoryRoutes = require('./routes/inventory');
const customerRoutes = require('./routes/customers');
const deliveryRoutes = require('./routes/deliveries');
const settingsRoutes  = require('./routes/settings');
const wishlistRoutes  = require('./routes/wishlist');

const app = express();

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  credentials: true,
}));

// Store raw body so the Paystack webhook handler can verify the HMAC signature
app.use(bodyParser.json({
  verify: (req, res, buf) => { req.rawBody = buf; },
}));
app.use(bodyParser.urlencoded({ extended: true }));

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/deliveries', deliveryRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/wishlist', wishlistRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.use(errorHandler);

// Purge stale token blacklist entries so the table doesn't grow unbounded
require('./config/database')
  .query('DELETE FROM token_blacklist WHERE expires_at < NOW()')
  .catch(console.error);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

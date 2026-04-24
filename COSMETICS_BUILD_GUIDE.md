# Cosmetics E-Commerce Platform: Complete Hard-Coded Build Guide

**Goal:** Build a production-ready e-commerce platform from scratch with minimal monthly costs (~$25-50/month).

**Stack:**
- Backend: Node.js + Express
- Database: PostgreSQL
- Frontend: React
- Mobile: Flutter
- Admin: React Dashboard
- Hosting: DigitalOcean ($5-20/month) + Netlify (free)

---

## Table of Contents

1. [Project Structure](#project-structure)
2. [Backend API (Node.js + Express)](#backend-api-nodejs--express)
3. [Database Schema (PostgreSQL)](#database-schema-postgresql)
4. [Authentication System (JWT)](#authentication-system-jwt)
5. [Payment Integration (Paystack)](#payment-integration-paystack)
6. [Frontend (React)](#frontend-react)
7. [Admin Dashboard](#admin-dashboard)
8. [Mobile App (Flutter)](#mobile-app-flutter)
9. [Deployment to DigitalOcean](#deployment-to-digitalocean)
10. [Post-Launch Operations](#post-launch-operations)

---

# Project Structure

```
cosmetics-ecommerce/
├── backend/                    # Node.js + Express API
│   ├── src/
│   │   ├── server.js          # Express setup
│   │   ├── config/
│   │   │   ├── database.js    # PostgreSQL connection
│   │   │   └── paystack.js    # Paystack config
│   │   ├── middleware/
│   │   │   ├── auth.js        # JWT verification
│   │   │   ├── errorHandler.js
│   │   │   └── validation.js
│   │   ├── routes/
│   │   │   ├── auth.js        # Login, register, forgot password
│   │   │   ├── products.js    # Product CRUD
│   │   │   ├── cart.js        # Cart management
│   │   │   ├── orders.js      # Order management
│   │   │   ├── payments.js    # Paystack integration
│   │   │   ├── inventory.js   # Stock management
│   │   │   ├── customers.js   # Customer profiles
│   │   │   ├── admin.js       # Admin endpoints
│   │   │   └── analytics.js   # Sales analytics
│   │   ├── controllers/       # Business logic
│   │   ├── models/            # Database queries
│   │   ├── utils/             # Helper functions
│   │   └── services/          # External integrations
│   ├── migrations/            # Database migrations
│   ├── .env.example           # Environment variables template
│   ├── package.json
│   └── README.md
│
├── frontend/                   # React Web App
│   ├── src/
│   │   ├── components/
│   │   │   ├── ProductCard.js
│   │   │   ├── Cart.js
│   │   │   ├── Checkout.js
│   │   │   ├── ProductDetail.js
│   │   │   ├── OrderTracker.js
│   │   │   └── Navigation.js
│   │   ├── pages/
│   │   │   ├── Home.js
│   │   │   ├── Shop.js
│   │   │   ├── ProductPage.js
│   │   │   ├── Cart.js
│   │   │   ├── Checkout.js
│   │   │   ├── Account.js
│   │   │   ├── Orders.js
│   │   │   └── Login.js
│   │   ├── services/
│   │   │   ├── api.js         # API calls to backend
│   │   │   └── auth.js        # Auth logic
│   │   ├── context/           # React Context for state
│   │   ├── styles/
│   │   ├── App.js
│   │   └── index.js
│   ├── public/
│   ├── package.json
│   └── .env.example
│
├── admin/                      # Admin Dashboard (React)
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Dashboard.js   # Overview, charts
│   │   │   ├── Products.js    # Add, edit products
│   │   │   ├── Orders.js      # Order management
│   │   │   ├── Customers.js   # Customer list
│   │   │   ├── Inventory.js   # Stock levels
│   │   │   └── Analytics.js   # Sales reports
│   │   ├── components/
│   │   ├── services/
│   │   ├── App.js
│   │   └── index.js
│   └── package.json
│
├── mobile/                     # Flutter App
│   ├── lib/
│   │   ├── main.dart
│   │   ├── screens/
│   │   │   ├── home_screen.dart
│   │   │   ├── product_detail_screen.dart
│   │   │   ├── cart_screen.dart
│   │   │   ├── checkout_screen.dart
│   │   │   └── orders_screen.dart
│   │   ├── widgets/
│   │   ├── services/
│   │   │   ├── api_service.dart
│   │   │   └── auth_service.dart
│   │   └── models/
│   ├── pubspec.yaml
│   └── android/, ios/
│
├── .gitignore
├── README.md
└── docker-compose.yml         # Local development with Docker
```

---

# Backend API (Node.js + Express)

## 1. Initial Setup

### Create Project

```bash
mkdir cosmetics-ecommerce && cd cosmetics-ecommerce
mkdir backend && cd backend

npm init -y

npm install express pg bcryptjs jsonwebtoken dotenv axios cors body-parser uuid

npm install --save-dev nodemon
```

### package.json Scripts

```json
{
  "scripts": {
    "start": "node src/server.js",
    "dev": "nodemon src/server.js",
    "migrate": "node migrations/run.js"
  }
}
```

---

## 2. Environment Setup (.env)

```bash
# .env (Never commit this to GitHub)

# Server
PORT=3000
NODE_ENV=development

# Database (PostgreSQL)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=cosmetics_db
DB_USER=postgres
DB_PASSWORD=your_secure_password

# JWT
JWT_SECRET=your_super_secret_key_change_this_in_production
JWT_EXPIRE=7d

# Paystack
PAYSTACK_SECRET_KEY=sk_test_xxx_from_paystack_dashboard
PAYSTACK_PUBLIC_KEY=pk_test_xxx_from_paystack_dashboard

# Email (optional, for notifications)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password

# Admin User (create on first run)
ADMIN_EMAIL=admin@cosmetics.com
ADMIN_PASSWORD=secure_password_change_this
```

---

## 3. Database Configuration

### src/config/database.js

```javascript
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// Test connection
pool.on('connect', () => {
  console.log('✓ Connected to PostgreSQL');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

module.exports = pool;
```

### src/config/paystack.js

```javascript
const axios = require('axios');

const paystackAPI = axios.create({
  baseURL: 'https://api.paystack.co',
  headers: {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
  },
});

module.exports = paystackAPI;
```

---

## 4. Database Schema (PostgreSQL)

Create these tables in PostgreSQL:

### migrations/001_create_tables.sql

```sql
-- Users Table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(20),
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  role VARCHAR(20) DEFAULT 'customer', -- 'customer', 'admin'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Products Table
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price DECIMAL(10, 2) NOT NULL,
  cost DECIMAL(10, 2), -- Cost to you
  category VARCHAR(100),
  brand VARCHAR(100),
  image_url VARCHAR(255),
  stock_quantity INT DEFAULT 0,
  sku VARCHAR(100) UNIQUE,
  ingredients TEXT,
  usage_instructions TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Orders Table
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES users(id),
  order_number VARCHAR(50) UNIQUE,
  total_amount DECIMAL(10, 2) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'paid', 'shipped', 'delivered', 'cancelled'
  payment_status VARCHAR(20) DEFAULT 'unpaid', -- 'unpaid', 'paid', 'refunded'
  payment_reference VARCHAR(100),
  shipping_address TEXT,
  shipping_city VARCHAR(100),
  shipping_region VARCHAR(100),
  delivery_fee DECIMAL(10, 2),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Order Items Table
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id),
  product_id UUID REFERENCES products(id),
  quantity INT NOT NULL,
  price_at_purchase DECIMAL(10, 2) NOT NULL,
  subtotal DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Cart Table (temporary)
CREATE TABLE cart_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES users(id),
  product_id UUID REFERENCES products(id),
  quantity INT NOT NULL,
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Payments Table
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id),
  amount DECIMAL(10, 2) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'success', 'failed'
  payment_method VARCHAR(50), -- 'paystack', 'momo', etc.
  paystack_reference VARCHAR(100),
  customer_email VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Delivery Tracking Table
CREATE TABLE deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id),
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'in_transit', 'delivered'
  delivery_partner VARCHAR(100),
  tracking_number VARCHAR(100),
  estimated_delivery DATE,
  actual_delivery_date DATE,
  driver_phone VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Inventory History (for tracking stock changes)
CREATE TABLE inventory_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id),
  quantity_change INT,
  reason VARCHAR(100), -- 'sale', 'restock', 'damage', 'return'
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Customers Table (extended user data)
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES users(id),
  phone VARCHAR(20),
  address TEXT,
  city VARCHAR(100),
  region VARCHAR(100),
  postal_code VARCHAR(20),
  total_spent DECIMAL(10, 2) DEFAULT 0,
  total_orders INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_cart_customer ON cart_items(customer_id);
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_payments_order ON payments(order_id);
CREATE INDEX idx_deliveries_order ON deliveries(order_id);
```

Run migrations:
```bash
psql -U postgres -d cosmetics_db -f migrations/001_create_tables.sql
```

---

## 5. Authentication (JWT)

### src/middleware/auth.js

```javascript
const jwt = require('jsonwebtoken');

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1]; // "Bearer token"

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // Attach user to request
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Middleware to check admin role
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

module.exports = { verifyToken, requireAdmin };
```

### src/routes/auth.js

```javascript
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const pool = require('../config/database');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// Register
router.post('/register', async (req, res) => {
  try {
    const { email, password, first_name, last_name, phone } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // Check if user exists
    const userExists = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userExists.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const userId = uuid();
    await pool.query(
      'INSERT INTO users (id, email, password_hash, first_name, last_name, phone, role) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [userId, email, hashedPassword, first_name, last_name, phone, 'customer']
    );

    // Create customer profile
    await pool.query(
      'INSERT INTO customers (user_id, phone) VALUES ($1, $2)',
      [userId, phone]
    );

    res.status(201).json({ message: 'User registered successfully', userId });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // Find user
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // Check password
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Create JWT token
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );

    res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get current user
router.get('/me', verifyToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, email, first_name, last_name, role FROM users WHERE id = $1', [req.user.id]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

module.exports = router;
```

---

## 6. Products API

### src/routes/products.js

```javascript
const express = require('express');
const pool = require('../config/database');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { v4: uuid } = require('uuid');

const router = express.Router();

// Get all products (with filters)
router.get('/', async (req, res) => {
  try {
    const { category, search, sort } = req.query;
    
    let query = 'SELECT * FROM products WHERE 1=1';
    const params = [];

    if (category) {
      query += ' AND category = $' + (params.length + 1);
      params.push(category);
    }

    if (search) {
      query += ' AND (name ILIKE $' + (params.length + 1) + ' OR description ILIKE $' + (params.length + 1) + ')';
      params.push(`%${search}%`);
    }

    // Sorting
    if (sort === 'price_low') query += ' ORDER BY price ASC';
    else if (sort === 'price_high') query += ' ORDER BY price DESC';
    else if (sort === 'newest') query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// Get single product
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

// Create product (admin only)
router.post('/', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { name, price, category, brand, description, image_url, stock_quantity, sku } = req.body;

    const productId = uuid();
    await pool.query(
      'INSERT INTO products (id, name, price, category, brand, description, image_url, stock_quantity, sku) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [productId, name, price, category, brand, description, image_url, stock_quantity, sku]
    );

    res.status(201).json({ id: productId, message: 'Product created' });
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// Update product (admin only)
router.put('/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { name, price, category, brand, description, image_url, stock_quantity } = req.body;

    await pool.query(
      'UPDATE products SET name = $1, price = $2, category = $3, brand = $4, description = $5, image_url = $6, stock_quantity = $7, updated_at = NOW() WHERE id = $8',
      [name, price, category, brand, description, image_url, stock_quantity, req.params.id]
    );

    res.json({ message: 'Product updated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// Delete product (admin only)
router.delete('/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
    res.json({ message: 'Product deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

module.exports = router;
```

---

## 7. Cart & Orders

### src/routes/cart.js

```javascript
const express = require('express');
const pool = require('../config/database');
const { verifyToken } = require('../middleware/auth');
const { v4: uuid } = require('uuid');

const router = express.Router();

// Get cart for user
router.get('/', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ci.id, ci.quantity, p.id as product_id, p.name, p.price, p.image_url
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       WHERE ci.customer_id = $1`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch cart' });
  }
});

// Add to cart
router.post('/add', verifyToken, async (req, res) => {
  try {
    const { product_id, quantity } = req.body;

    // Check if product exists and has stock
    const productResult = await pool.query('SELECT * FROM products WHERE id = $1', [product_id]);
    if (productResult.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    if (productResult.rows[0].stock_quantity < quantity) {
      return res.status(400).json({ error: 'Insufficient stock' });
    }

    // Check if item already in cart
    const existingItem = await pool.query(
      'SELECT * FROM cart_items WHERE customer_id = $1 AND product_id = $2',
      [req.user.id, product_id]
    );

    if (existingItem.rows.length > 0) {
      // Update quantity
      await pool.query(
        'UPDATE cart_items SET quantity = quantity + $1 WHERE customer_id = $2 AND product_id = $3',
        [quantity, req.user.id, product_id]
      );
    } else {
      // Add new item
      await pool.query(
        'INSERT INTO cart_items (id, customer_id, product_id, quantity) VALUES ($1, $2, $3, $4)',
        [uuid(), req.user.id, product_id, quantity]
      );
    }

    res.json({ message: 'Item added to cart' });
  } catch (error) {
    console.error('Error adding to cart:', error);
    res.status(500).json({ error: 'Failed to add to cart' });
  }
});

// Remove from cart
router.delete('/:cartItemId', verifyToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM cart_items WHERE id = $1 AND customer_id = $2', [req.params.cartItemId, req.user.id]);
    res.json({ message: 'Item removed from cart' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove item' });
  }
});

// Clear cart
router.delete('/', verifyToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM cart_items WHERE customer_id = $1', [req.user.id]);
    res.json({ message: 'Cart cleared' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear cart' });
  }
});

module.exports = router;
```

### src/routes/orders.js

```javascript
const express = require('express');
const pool = require('../config/database');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { v4: uuid } = require('uuid');

const router = express.Router();

// Create order from cart
router.post('/', verifyToken, async (req, res) => {
  try {
    const { shipping_address, shipping_city, shipping_region, delivery_fee } = req.body;

    // Get cart items
    const cartResult = await pool.query(
      'SELECT ci.quantity, p.id, p.price FROM cart_items ci JOIN products p ON ci.product_id = p.id WHERE ci.customer_id = $1',
      [req.user.id]
    );

    if (cartResult.rows.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    // Calculate total
    let total = 0;
    cartResult.rows.forEach(item => {
      total += item.price * item.quantity;
    });
    total += delivery_fee || 0;

    // Create order
    const orderId = uuid();
    const orderNumber = `ORD-${Date.now()}`;

    await pool.query(
      'INSERT INTO orders (id, customer_id, order_number, total_amount, shipping_address, shipping_city, shipping_region, delivery_fee, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [orderId, req.user.id, orderNumber, total, shipping_address, shipping_city, shipping_region, delivery_fee || 0, 'pending']
    );

    // Add order items
    for (const item of cartResult.rows) {
      const subtotal = item.price * item.quantity;
      await pool.query(
        'INSERT INTO order_items (id, order_id, product_id, quantity, price_at_purchase, subtotal) VALUES ($1, $2, $3, $4, $5, $6)',
        [uuid(), orderId, item.id, item.quantity, item.price, subtotal]
      );

      // Update product stock
      await pool.query(
        'UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2',
        [item.quantity, item.id]
      );

      // Log inventory change
      await pool.query(
        'INSERT INTO inventory_history (id, product_id, quantity_change, reason) VALUES ($1, $2, $3, $4)',
        [uuid(), item.id, -item.quantity, 'sale']
      );
    }

    // Clear cart
    await pool.query('DELETE FROM cart_items WHERE customer_id = $1', [req.user.id]);

    res.status(201).json({ orderId, orderNumber, total });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// Get user's orders
router.get('/', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, order_number, total_amount, status, created_at FROM orders WHERE customer_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// Get order details
router.get('/:orderId', verifyToken, async (req, res) => {
  try {
    const orderResult = await pool.query('SELECT * FROM orders WHERE id = $1 AND customer_id = $2', [req.params.orderId, req.user.id]);
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const itemsResult = await pool.query(
      'SELECT oi.*, p.name, p.image_url FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = $1',
      [req.params.orderId]
    );

    res.json({ order: orderResult.rows[0], items: itemsResult.rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

// Get all orders (admin)
router.get('/admin/all', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT o.*, u.email, u.first_name FROM orders o JOIN users u ON o.customer_id = u.id ORDER BY o.created_at DESC'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// Update order status (admin)
router.patch('/:orderId/status', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    await pool.query('UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2', [status, req.params.orderId]);
    res.json({ message: 'Order status updated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update order' });
  }
});

module.exports = router;
```

---

## 8. Payment Integration (Paystack)

### src/routes/payments.js

```javascript
const express = require('express');
const pool = require('../config/database');
const paystackAPI = require('../config/paystack');
const { verifyToken } = require('../middleware/auth');
const { v4: uuid } = require('uuid');

const router = express.Router();

// Initialize payment
router.post('/initialize', verifyToken, async (req, res) => {
  try {
    const { orderId, email } = req.body;

    // Get order details
    const orderResult = await pool.query('SELECT * FROM orders WHERE id = $1 AND customer_id = $2', [orderId, req.user.id]);
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = orderResult.rows[0];

    // Initialize Paystack transaction
    const response = await paystackAPI.post('/transaction/initialize', {
      email: email || req.user.email,
      amount: order.total_amount * 100, // Convert to cents
      metadata: {
        orderId: orderId,
        userId: req.user.id,
      },
    });

    // Store payment record
    await pool.query(
      'INSERT INTO payments (id, order_id, amount, status, paystack_reference, customer_email) VALUES ($1, $2, $3, $4, $5, $6)',
      [uuid(), orderId, order.total_amount, 'pending', response.data.data.reference, email || req.user.email]
    );

    res.json({
      authorization_url: response.data.data.authorization_url,
      access_code: response.data.data.access_code,
      reference: response.data.data.reference,
    });
  } catch (error) {
    console.error('Paystack init error:', error);
    res.status(500).json({ error: 'Failed to initialize payment' });
  }
});

// Verify payment
router.post('/verify', async (req, res) => {
  try {
    const { reference } = req.body;

    // Verify with Paystack
    const response = await paystackAPI.get(`/transaction/verify/${reference}`);

    if (response.data.data.status === 'success') {
      const { orderId } = response.data.data.metadata;

      // Update order and payment status
      await pool.query('UPDATE orders SET status = $1, payment_status = $2, payment_reference = $3, updated_at = NOW() WHERE id = $4', 
        ['paid', 'paid', reference, orderId]);

      await pool.query('UPDATE payments SET status = $1, updated_at = NOW() WHERE paystack_reference = $2', 
        ['success', reference]);

      res.json({ status: 'success', orderId });
    } else {
      await pool.query('UPDATE payments SET status = $1 WHERE paystack_reference = $2', 
        ['failed', reference]);
      res.status(400).json({ error: 'Payment failed' });
    }
  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({ error: 'Failed to verify payment' });
  }
});

// Paystack webhook (for server-side payment confirmation)
router.post('/webhook', async (req, res) => {
  try {
    const { data, event } = req.body;

    if (event === 'charge.success') {
      const { reference, metadata } = data;
      const { orderId } = metadata;

      // Update order
      await pool.query('UPDATE orders SET status = $1, payment_status = $2, updated_at = NOW() WHERE id = $3',
        ['paid', 'paid', orderId]);

      // Update payment
      await pool.query('UPDATE payments SET status = $1 WHERE paystack_reference = $2',
        ['success', reference]);

      // TODO: Send confirmation email to customer
      // TODO: Notify admin of new order
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error);
    res.sendStatus(500);
  }
});

module.exports = router;
```

---

## 9. Admin Routes

### src/routes/admin.js

```javascript
const express = require('express');
const pool = require('../config/database');
const { verifyToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Dashboard stats
router.get('/dashboard', verifyToken, requireAdmin, async (req, res) => {
  try {
    // Total revenue
    const revenueResult = await pool.query(
      'SELECT SUM(total_amount) as total_revenue FROM orders WHERE status = $1',
      ['paid']
    );

    // Total orders
    const ordersResult = await pool.query('SELECT COUNT(*) FROM orders');

    // Total customers
    const customersResult = await pool.query('SELECT COUNT(*) FROM users WHERE role = $1', ['customer']);

    // Total products
    const productsResult = await pool.query('SELECT COUNT(*) FROM products');

    // Recent orders
    const recentOrdersResult = await pool.query(
      'SELECT id, order_number, total_amount, status, created_at FROM orders ORDER BY created_at DESC LIMIT 10'
    );

    res.json({
      totalRevenue: revenueResult.rows[0].total_revenue || 0,
      totalOrders: ordersResult.rows[0].count,
      totalCustomers: customersResult.rows[0].count,
      totalProducts: productsResult.rows[0].count,
      recentOrders: recentOrdersResult.rows,
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// Sales analytics
router.get('/analytics', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as orders,
        SUM(total_amount) as revenue
      FROM orders
      WHERE status = $1
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      LIMIT 30
    `, ['paid']);

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// Top products
router.get('/top-products', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.id, p.name, p.price, COUNT(oi.id) as times_sold, SUM(oi.quantity) as total_quantity
      FROM products p
      JOIN order_items oi ON p.id = oi.product_id
      GROUP BY p.id, p.name, p.price
      ORDER BY total_quantity DESC
      LIMIT 10
    `);

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch top products' });
  }
});

// Inventory status
router.get('/inventory', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, stock_quantity, price FROM products ORDER BY stock_quantity ASC
    `);

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch inventory' });
  }
});

module.exports = router;
```

---

## 10. Main Server File

### src/server.js

```javascript
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

// Import routes
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const cartRoutes = require('./routes/cart');
const orderRoutes = require('./routes/orders');
const paymentRoutes = require('./routes/payments');
const adminRoutes = require('./routes/admin');

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✓ Server running on http://localhost:${PORT}`);
});
```

---

# Frontend (React)

## Installation

```bash
cd ../frontend
npx create-react-app . --template
npm install axios react-router-dom

# Or use Vite (faster)
npm create vite@latest . -- --template react
npm install
```

## Key Components

### src/services/api.js

```javascript
import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3000/api';

const api = axios.create({ baseURL: API_BASE });

// Add token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const auth = {
  register: (data) => api.post('/auth/register', data),
  login: (data) => api.post('/auth/login', data),
  getMe: () => api.get('/auth/me'),
};

export const products = {
  getAll: (params) => api.get('/products', { params }),
  getById: (id) => api.get(`/products/${id}`),
  create: (data) => api.post('/products', data),
  update: (id, data) => api.put(`/products/${id}`, data),
  delete: (id) => api.delete(`/products/${id}`),
};

export const cart = {
  getCart: () => api.get('/cart'),
  addItem: (data) => api.post('/cart/add', data),
  removeItem: (id) => api.delete(`/cart/${id}`),
  clear: () => api.delete('/cart'),
};

export const orders = {
  create: (data) => api.post('/orders', data),
  getAll: () => api.get('/orders'),
  getById: (id) => api.get(`/orders/${id}`),
};

export const payments = {
  initialize: (data) => api.post('/payments/initialize', data),
  verify: (data) => api.post('/payments/verify', data),
};

export default api;
```

### src/pages/Shop.js

```javascript
import { useState, useEffect } from 'react';
import { products } from '../services/api';
import ProductCard from '../components/ProductCard';

export default function Shop() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const response = await products.getAll({ category, search });
        setItems(response.data);
      } catch (error) {
        console.error('Error fetching products:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchProducts();
  }, [category, search]);

  return (
    <div className="shop">
      <h1>Shop</h1>
      
      <input
        type="text"
        placeholder="Search products..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <select value={category} onChange={(e) => setCategory(e.target.value)}>
        <option value="">All Categories</option>
        <option value="skincare">Skincare</option>
        <option value="makeup">Makeup</option>
        <option value="haircare">Haircare</option>
      </select>

      {loading ? (
        <p>Loading...</p>
      ) : (
        <div className="products-grid">
          {items.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}
```

### src/pages/Checkout.js

```javascript
import { useState } from 'react';
import { orders, payments } from '../services/api';

export default function Checkout() {
  const [form, setForm] = useState({
    shipping_address: '',
    shipping_city: '',
    shipping_region: '',
    delivery_fee: 0,
  });
  const [loading, setLoading] = useState(false);

  const handleCheckout = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Create order
      const orderResponse = await orders.create(form);
      const { orderId, total } = orderResponse.data;

      // Initialize payment
      const paymentResponse = await payments.initialize({
        orderId,
        email: localStorage.getItem('userEmail'),
      });

      // Redirect to Paystack
      window.location.href = paymentResponse.data.authorization_url;
    } catch (error) {
      console.error('Checkout error:', error);
      alert('Checkout failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleCheckout}>
      <input
        type="text"
        placeholder="Address"
        value={form.shipping_address}
        onChange={(e) => setForm({ ...form, shipping_address: e.target.value })}
      />
      <input
        type="text"
        placeholder="City"
        value={form.shipping_city}
        onChange={(e) => setForm({ ...form, shipping_city: e.target.value })}
      />
      <input
        type="text"
        placeholder="Region"
        value={form.shipping_region}
        onChange={(e) => setForm({ ...form, shipping_region: e.target.value })}
      />
      <input
        type="number"
        placeholder="Delivery Fee"
        value={form.delivery_fee}
        onChange={(e) => setForm({ ...form, delivery_fee: parseFloat(e.target.value) })}
      />
      <button type="submit" disabled={loading}>
        {loading ? 'Processing...' : 'Proceed to Payment'}
      </button>
    </form>
  );
}
```

---

# Admin Dashboard

Same structure as frontend, but with admin-specific pages:
- Dashboard (overview, charts)
- Product Management
- Order Management
- Customer Management
- Analytics

```bash
cd ../admin
npx create-react-app .
npm install recharts
```

---

# Mobile App (Flutter)

### pubspec.yaml

```yaml
dependencies:
  flutter:
    sdk: flutter
  http: ^1.1.0
  shared_preferences: ^2.2.0
  provider: ^6.0.0
  flutter_dotenv: ^5.1.0
  
dev_dependencies:
  flutter_test:
    sdk: flutter
```

### lib/services/api_service.dart

```dart
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

class ApiService {
  static const String baseUrl = 'http://your-api-url.com/api';

  // Get token from storage
  static Future<String?> getToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('token');
  }

  // Login
  static Future<Map> login(String email, String password) async {
    final response = await http.post(
      Uri.parse('$baseUrl/auth/login'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'email': email, 'password': password}),
    );

    if (response.statusCode == 200) {
      final data = jsonDecode(response.body);
      final prefs = await SharedPreferences.getInstance();
      prefs.setString('token', data['token']);
      return data;
    } else {
      throw Exception('Login failed');
    }
  }

  // Get products
  static Future<List> getProducts() async {
    final response = await http.get(
      Uri.parse('$baseUrl/products'),
      headers: await _getHeaders(),
    );

    if (response.statusCode == 200) {
      return jsonDecode(response.body);
    } else {
      throw Exception('Failed to load products');
    }
  }

  // Add to cart
  static Future addToCart(String productId, int quantity) async {
    final token = await getToken();
    final response = await http.post(
      Uri.parse('$baseUrl/cart/add'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: jsonEncode({'product_id': productId, 'quantity': quantity}),
    );

    if (response.statusCode != 200) {
      throw Exception('Failed to add to cart');
    }
  }

  static Future<Map<String, String>> _getHeaders() async {
    final token = await getToken();
    return {
      'Content-Type': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
    };
  }
}
```

---

# Deployment to DigitalOcean

## 1. Create Droplet

```bash
# SSH into server
ssh root@your_server_ip

# Update system
apt update && apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt install -y nodejs

# Install PostgreSQL
apt install -y postgresql postgresql-contrib

# Install PM2 (keep app running)
npm install -g pm2

# Install Nginx (reverse proxy)
apt install -y nginx

# Clone your GitHub repo
cd /home
git clone https://github.com/yourusername/cosmetics-ecommerce.git
cd cosmetics-ecommerce/backend

# Install dependencies
npm install

# Create .env file with production variables
nano .env
# Add your Paystack keys, database password, etc.

# Start app
pm2 start src/server.js --name cosmetics-api
pm2 save
```

## 2. Setup PostgreSQL

```bash
# Login to PostgreSQL
sudo -u postgres psql

# Create database and user
CREATE DATABASE cosmetics_db;
CREATE USER cosmetics_user WITH PASSWORD 'secure_password';
ALTER ROLE cosmetics_user SET client_encoding TO 'utf8';
ALTER ROLE cosmetics_user SET default_transaction_isolation TO 'read committed';
ALTER ROLE cosmetics_user SET default_transaction_deferrable TO on;
ALTER ROLE cosmetics_user SET search_path = public;
GRANT ALL PRIVILEGES ON DATABASE cosmetics_db TO cosmetics_user;
\q

# Run migrations
psql -U cosmetics_user -d cosmetics_db -f /home/cosmetics-ecommerce/backend/migrations/001_create_tables.sql
```

## 3. Setup Nginx

```bash
# Create Nginx config
nano /etc/nginx/sites-available/cosmetics

# Add this:
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}

# Enable it
ln -s /etc/nginx/sites-available/cosmetics /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx

# Setup SSL (free with Let's Encrypt)
apt install -y certbot python3-certbot-nginx
certbot --nginx -d yourdomain.com
```

## 4. Deploy Frontend

```bash
# Build React app
cd /home/cosmetics-ecommerce/frontend
npm run build

# Upload to Netlify (free)
npm install -g netlify-cli
netlify deploy --prod --dir=build
```

---

# Post-Launch Operations

## Monitoring

```bash
# Check app logs
pm2 logs cosmetics-api

# Monitor system
top
free -h
df -h

# Check database
psql -U cosmetics_user -d cosmetics_db
SELECT COUNT(*) FROM orders;
```

## Backups

```bash
# Daily backup script (/home/backup.sh)
#!/bin/bash
BACKUP_DIR="/backups"
DATE=$(date +%Y%m%d)

pg_dump -U cosmetics_user cosmetics_db > $BACKUP_DIR/cosmetics_db_$DATE.sql

# Delete old backups (keep last 7 days)
find $BACKUP_DIR -name "*.sql" -mtime +7 -delete

# Add to cron
crontab -e
# Add: 0 2 * * * /home/backup.sh
```

## Updates

```bash
# Pull latest code
cd /home/cosmetics-ecommerce/backend
git pull origin main

# Install new dependencies
npm install

# Run migrations (if any)
npm run migrate

# Restart app
pm2 restart cosmetics-api
```

---

# Monthly Costs Breakdown

| Service | Cost |
|---------|------|
| DigitalOcean Droplet (5$/month) | $5 |
| PostgreSQL (managed, included) | $0 |
| Domain (GoDaddy, annual) | $0.33 |
| Netlify (free tier) | $0 |
| Paystack (1.5% transaction fee) | Variable |
| **Total** | ~$10-30/month |

---

# Quick Reference: What You're Hard-Coding

## Backend
- ✅ User authentication (register, login, JWT)
- ✅ Product CRUD (create, read, update, delete)
- ✅ Cart management
- ✅ Order creation & tracking
- ✅ Paystack payment integration
- ✅ Admin endpoints
- ✅ Database design
- ✅ API documentation

## Frontend
- ✅ Product listing with filters
- ✅ Product detail page
- ✅ Shopping cart
- ✅ Checkout flow
- ✅ Payment integration
- ✅ User account
- ✅ Order tracking

## Admin
- ✅ Dashboard (stats, charts)
- ✅ Product management
- ✅ Order management
- ✅ Customer management
- ✅ Inventory tracking
- ✅ Analytics

## Mobile
- ✅ Product browsing
- ✅ Cart management
- ✅ Checkout
- ✅ Order tracking
- ✅ User account

---

# Git Workflow

```bash
# Initialize repo
git init
git add .
git commit -m "Initial commit: backend, frontend, admin, mobile setup"
git branch -M main
git remote add origin https://github.com/yourusername/cosmetics-ecommerce.git
git push -u origin main

# Daily workflow
git add .
git commit -m "Add: feature name"
git push origin main

# Deploy on server
ssh root@your_server_ip
cd /home/cosmetics-ecommerce/backend
git pull origin main
npm install
pm2 restart cosmetics-api
```

---

# Success Checklist

**Before Launch:**
- [ ] Database set up with all tables
- [ ] Backend API tested locally
- [ ] Authentication working (register, login)
- [ ] Products showing on frontend
- [ ] Cart functionality working
- [ ] Paystack integration tested (sandbox mode)
- [ ] Admin dashboard accessible
- [ ] Mobile app compiles

**Deployment:**
- [ ] Server (DigitalOcean) running
- [ ] Database migrated to production
- [ ] Environment variables set
- [ ] PM2 keeping app alive
- [ ] Nginx routing traffic correctly
- [ ] SSL certificate installed
- [ ] Frontend deployed to Netlify
- [ ] Domain configured

**Post-Launch:**
- [ ] Customer can register & login
- [ ] Products display correctly
- [ ] Test payment (use Paystack test keys)
- [ ] Order created in database
- [ ] Admin can view orders
- [ ] Monitor logs for errors
- [ ] Set up daily backups

---

# Cost Breakdown: Your Proposal vs Reality

| Item | Proposal | Actual (Hard-Coded) | Savings |
|------|----------|-------------------|---------|
| Monthly hosting | $15-50 | $5-10 | **80% cheaper** |
| Database | Included | Included | $0 |
| Frontend hosting | $0-20 | $0 (Netlify free) | **Free** |
| Domain | $3-5 | $3-5 | Same |
| Payment processing | 1.5% + ₵0.50 | 1.5% + ₵0.50 | Same |
| **Total/month** | **$20-75** | **$10-20** | **50% cheaper** |

---

# Contact & Support

For questions on:
- Backend setup: Focus on Node.js docs, Express docs, PostgreSQL docs
- Frontend: React docs, Axios docs
- Deployment: DigitalOcean docs, PM2 docs
- Payments: Paystack docs
- Mobile: Flutter docs

---

**Built with care for Ghana's cosmetics industry.**

This guide is your roadmap to a production-ready e-commerce platform at a fraction of the cost of traditional SaaS solutions.

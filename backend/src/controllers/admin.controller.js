const path   = require('path');
const fs     = require('fs');
const { randomUUID: uuidv4 } = require('crypto');
const bcrypt = require('bcryptjs');
const pool   = require('../config/database');
const logger = require('../utils/logger');

// ── Image upload constants ────────────────────────────────────────────────────
const MAX_IMAGES_PER_PRODUCT = 8;
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'products');

const MIME_EXT_MAP = {
  'image/jpeg': '.jpg',
  'image/jpg':  '.jpg',
  'image/png':  '.png',
  'image/webp': '.webp',
};

// ── Shared helpers ────────────────────────────────────────────────────────────

async function getProductImages(productId) {
  const { rows } = await pool.query(
    `SELECT id, url, filename, original_name, mime_type, size_bytes, sort_order, is_primary
       FROM product_images
      WHERE product_id = $1
      ORDER BY sort_order ASC`,
    [productId]
  );
  return rows;
}

async function deleteFileSafe(filename) {
  try {
    await fs.promises.unlink(path.join(UPLOAD_DIR, filename));
  } catch (err) {
    logger.error('deleteFileSafe: could not delete file', { filename, err: err.message });
  }
}

// ── Existing admin handlers ───────────────────────────────────────────────────

const getDashboard = async (req, res) => {
  try {
    const [revenue, orders, customers, products, recentOrdersResult, todayRevenueResult, lowStockResult] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(total_amount), 0) AS total_revenue FROM orders WHERE payment_status = 'paid'`),
      pool.query(`SELECT COUNT(*) AS total_orders, COUNT(*) FILTER (WHERE payment_status = 'paid') AS paid_orders FROM orders`),
      pool.query(`SELECT COUNT(*) AS total_customers FROM users WHERE role = 'customer'`),
      pool.query('SELECT COUNT(*) AS total_products FROM products'),
      pool.query(`
        SELECT o.id, o.order_number, o.total_amount, o.status, o.payment_status, o.created_at,
               COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.email, o.guest_email, 'Guest') AS customer_name,
               COALESCE(u.email, o.guest_email) AS customer_email
          FROM orders o
          LEFT JOIN users u ON o.customer_id = u.id
         ORDER BY o.created_at DESC
         LIMIT 10
      `),
      pool.query(`
        SELECT COALESCE(SUM(total_amount), 0) AS today_revenue
          FROM orders
         WHERE payment_status = 'paid' AND DATE(created_at) = CURRENT_DATE
      `),
      pool.query(`SELECT COUNT(*) AS low_stock_count FROM products WHERE stock_quantity <= 5`),
    ]);

    const totalRevenue = parseFloat(revenue.rows[0].total_revenue);
    const totalOrders  = parseInt(orders.rows[0].total_orders, 10);
    const paidOrders   = parseInt(orders.rows[0].paid_orders, 10);

    res.json({
      totalRevenue,
      totalOrders,
      paidOrders,
      totalCustomers:  parseInt(customers.rows[0].total_customers, 10),
      totalProducts:   parseInt(products.rows[0].total_products, 10),
      todayRevenue:    parseFloat(todayRevenueResult.rows[0].today_revenue),
      avgOrderValue:   paidOrders > 0 ? Math.round((totalRevenue / paidOrders) * 100) / 100 : 0,
      lowStockCount:   parseInt(lowStockResult.rows[0].low_stock_count, 10),
      recentOrders:    recentOrdersResult.rows,
    });
  } catch (error) {
    logger.error('Dashboard error', { err: error.message });
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
};

const getAnalytics = async (req, res) => {
  try {
    const { from, to, days } = req.query;
    let whereClause, params;

    if (from && to) {
      whereClause = `WHERE payment_status = 'paid' AND DATE(created_at) BETWEEN $1::date AND $2::date`;
      params = [from, to];
    } else {
      const d = Math.min(365, Math.max(1, parseInt(days) || 30));
      whereClause = `WHERE payment_status = 'paid' AND created_at >= NOW() - ($1::int * INTERVAL '1 day')`;
      params = [d];
    }

    const { rows } = await pool.query(`
      SELECT DATE(created_at) AS date, COUNT(*) AS orders, SUM(total_amount) AS revenue
        FROM orders
        ${whereClause}
       GROUP BY DATE(created_at)
       ORDER BY date ASC
    `, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
};

const getTopProducts = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.id, p.name, p.price, COUNT(oi.id) as times_sold, SUM(oi.quantity) as total_quantity
      FROM products p JOIN order_items oi ON p.id = oi.product_id
      GROUP BY p.id, p.name, p.price
      ORDER BY total_quantity DESC LIMIT 10
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch top products' });
  }
};

const getInventoryOverview = async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, sku, stock_quantity, price FROM products ORDER BY stock_quantity ASC'
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch inventory' });
  }
};

const getAllCustomers = async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const search = req.query.search?.trim() || '';
    const sort   = req.query.sort || 'created_at_desc';

    const filterParams = [];
    let whereClause = `WHERE u.role = 'customer'`;

    if (search) {
      filterParams.push(`%${search}%`);
      whereClause += ` AND (u.email ILIKE $${filterParams.length} OR u.first_name ILIKE $${filterParams.length} OR u.last_name ILIKE $${filterParams.length})`;
    }

    const orderMap = {
      created_at_desc: 'u.created_at DESC',
      created_at_asc:  'u.created_at ASC',
      name_asc:        'u.first_name ASC',
      name_desc:       'u.first_name DESC',
    };
    const orderBy = orderMap[sort] || 'u.created_at DESC';

    const countParams = [...filterParams];
    const dataParams  = [...filterParams, limit, offset];

    const [dataResult, countResult] = await Promise.all([
      pool.query(`
        SELECT u.id, u.email, u.first_name, u.last_name, u.created_at,
               c.total_spent, c.total_orders
          FROM users u LEFT JOIN customers c ON u.id = c.user_id
          ${whereClause}
         ORDER BY ${orderBy}
         LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
      `, dataParams),
      pool.query(`SELECT COUNT(*) FROM users u ${whereClause}`, countParams),
    ]);

    const total = parseInt(countResult.rows[0].count);
    res.json({
      data:       dataResult.rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
};

// ── Product image handlers ────────────────────────────────────────────────────

const uploadProductImages = async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const productId = req.params.id;
  const client    = await pool.connect();
  const writtenFiles = [];

  try {
    await client.query('BEGIN');

    const { rows: productRows } = await client.query(
      'SELECT id FROM products WHERE id = $1 FOR UPDATE',
      [productId]
    );
    if (!productRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Product not found' });
    }

    const { rows: countRows } = await client.query(
      'SELECT COUNT(*)::int AS count FROM product_images WHERE product_id = $1',
      [productId]
    );
    const existingCount = countRows[0].count;

    if (existingCount + req.files.length > MAX_IMAGES_PER_PRODUCT) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Product already has ${existingCount} image${existingCount !== 1 ? 's' : ''}. ` +
               `Uploading ${req.files.length} more would exceed the ${MAX_IMAGES_PER_PRODUCT}-image limit.`,
      });
    }

    // Count check passed — write buffers to disk
    const insertRows = [];
    for (let i = 0; i < req.files.length; i++) {
      const file     = req.files[i];
      const ext      = MIME_EXT_MAP[file.mimetype];
      const filename = `${uuidv4()}${ext}`;
      const url      = `/uploads/products/${filename}`;

      await fs.promises.writeFile(path.join(UPLOAD_DIR, filename), file.buffer);
      writtenFiles.push(filename);

      insertRows.push({
        filename,
        url,
        original_name: file.originalname,
        mime_type:     file.mimetype,
        size_bytes:    file.size,
        sort_order:    existingCount + i,
        is_primary:    existingCount === 0 && i === 0,
      });
    }

    for (const row of insertRows) {
      await client.query(
        `INSERT INTO product_images
           (product_id, url, filename, original_name, mime_type, size_bytes, sort_order, is_primary)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [productId, row.url, row.filename, row.original_name,
         row.mime_type, row.size_bytes, row.sort_order, row.is_primary]
      );
    }

    await client.query('COMMIT');
    res.json({ images: await getProductImages(productId) });

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    for (const f of writtenFiles) await deleteFileSafe(f);
    logger.error('uploadProductImages error', { err: err.message, productId });
    res.status(500).json({ error: 'Failed to upload images' });
  } finally {
    client.release();
  }
};

const deleteProductImage = async (req, res) => {
  const { id: productId, imageId } = req.params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: productRows } = await client.query(
      'SELECT id FROM products WHERE id = $1 FOR UPDATE',
      [productId]
    );
    if (!productRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Product not found' });
    }

    const { rows: imageRows } = await client.query(
      'SELECT filename FROM product_images WHERE id = $1 AND product_id = $2',
      [imageId, productId]
    );
    if (!imageRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Image not found' });
    }

    const { filename } = imageRows[0];

    // Delete the row; if it was primary, promote the next image by sort_order.
    // next_image excludes the deleted row via AND id != $1 because PostgreSQL
    // CTEs run against the same snapshot — the DELETE is not yet visible to
    // the subsequent SELECT.
    await client.query(
      `WITH deleted AS (
         DELETE FROM product_images
          WHERE id = $1 AND product_id = $2
         RETURNING is_primary
       ),
       next_image AS (
         SELECT id FROM product_images
          WHERE product_id = $2
            AND id != $1
          ORDER BY sort_order ASC
          LIMIT 1
       )
       UPDATE product_images
          SET is_primary = true
        WHERE id = (SELECT id FROM next_image)
          AND (SELECT is_primary FROM deleted) = true`,
      [imageId, productId]
    );

    await client.query('COMMIT');
    await deleteFileSafe(filename);

    res.json({ images: await getProductImages(productId) });

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('deleteProductImage error', { err: err.message, productId, imageId });
    res.status(500).json({ error: 'Failed to delete image' });
  } finally {
    client.release();
  }
};

const reorderProductImages = async (req, res) => {
  const { id: productId } = req.params;
  const { order } = req.body;

  if (!Array.isArray(order) || order.length === 0) {
    return res.status(400).json({ error: 'order must be a non-empty array of image IDs' });
  }
  if (new Set(order).size !== order.length) {
    return res.status(400).json({ error: 'order contains duplicate image IDs' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: productRows } = await client.query(
      'SELECT id FROM products WHERE id = $1 FOR UPDATE',
      [productId]
    );
    if (!productRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Product not found' });
    }

    const { rows: existingRows } = await client.query(
      'SELECT id FROM product_images WHERE product_id = $1',
      [productId]
    );
    const existingIds = new Set(existingRows.map(r => r.id));

    if (order.length !== existingIds.size) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `order must contain all ${existingIds.size} image ID(s) for this product`,
      });
    }

    for (const id of order) {
      if (!existingIds.has(id)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Image ID ${id} does not belong to this product` });
      }
    }

    for (let i = 0; i < order.length; i++) {
      await client.query(
        'UPDATE product_images SET sort_order = $1 WHERE id = $2 AND product_id = $3',
        [i, order[i], productId]
      );
    }

    await client.query('COMMIT');
    res.json({ images: await getProductImages(productId) });

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('reorderProductImages error', { err: err.message, productId });
    res.status(500).json({ error: 'Failed to reorder images' });
  } finally {
    client.release();
  }
};

const setPrimaryProductImage = async (req, res) => {
  const { id: productId, imageId } = req.params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: productRows } = await client.query(
      'SELECT id FROM products WHERE id = $1 FOR UPDATE',
      [productId]
    );
    if (!productRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Product not found' });
    }

    const { rows: imageRows } = await client.query(
      'SELECT id FROM product_images WHERE id = $1 AND product_id = $2',
      [imageId, productId]
    );
    if (!imageRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Image not found' });
    }

    await client.query(
      'UPDATE product_images SET is_primary = false WHERE product_id = $1',
      [productId]
    );
    await client.query(
      'UPDATE product_images SET is_primary = true WHERE id = $1 AND product_id = $2',
      [imageId, productId]
    );

    await client.query('COMMIT');
    res.json({ images: await getProductImages(productId) });

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('setPrimaryProductImage error', { err: err.message, productId, imageId });
    res.status(500).json({ error: 'Failed to set primary image' });
  } finally {
    client.release();
  }
};

// ── Financials ────────────────────────────────────────────────────────────────

const getFinancials = async (req, res) => {
  try {
    const { from, to, days } = req.query;
    let dateFilter, params;

    if (from && to) {
      dateFilter = `AND DATE(created_at) BETWEEN $1::date AND $2::date`;
      params = [from, to];
    } else {
      const d = Math.min(365, Math.max(1, parseInt(days) || 30));
      dateFilter = `AND created_at >= NOW() - ($1::int * INTERVAL '1 day')`;
      params = [d];
    }

    const [summaryResult, dailyResult, pendingResult] = await Promise.all([
      pool.query(`
        SELECT
          COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total_amount ELSE 0 END), 0) AS gross_revenue,
          COALESCE(SUM(CASE WHEN refund_status = 'success' THEN refund_amount ELSE 0 END), 0) AS total_refunded,
          COUNT(CASE WHEN payment_status = 'paid' THEN 1 END)::int AS paid_orders,
          COUNT(CASE WHEN refund_status = 'success' THEN 1 END)::int AS refunded_orders
        FROM orders WHERE TRUE ${dateFilter}
      `, params),
      pool.query(`
        SELECT DATE(created_at) AS date,
               COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total_amount ELSE 0 END), 0) AS revenue,
               COALESCE(SUM(CASE WHEN refund_status = 'success' THEN refund_amount ELSE 0 END), 0) AS refunded
          FROM orders WHERE TRUE ${dateFilter}
         GROUP BY DATE(created_at) ORDER BY date ASC
      `, params),
      pool.query(`SELECT COALESCE(SUM(refund_amount), 0) AS pending_refunds FROM orders WHERE refund_status = 'pending'`),
    ]);

    const s            = summaryResult.rows[0];
    const grossRevenue = parseFloat(s.gross_revenue);
    const totalRefunded = parseFloat(s.total_refunded);
    const paidOrders   = s.paid_orders;
    const refundedOrders = s.refunded_orders;

    res.json({
      gross_revenue:   grossRevenue,
      total_refunded:  totalRefunded,
      net_revenue:     grossRevenue - totalRefunded,
      avg_order_value: paidOrders > 0 ? Math.round((grossRevenue / paidOrders) * 100) / 100 : 0,
      refund_rate:     paidOrders > 0 ? Math.round((refundedOrders / paidOrders) * 10000) / 100 : 0,
      pending_refunds: parseFloat(pendingResult.rows[0].pending_refunds),
      daily_series:    dailyResult.rows,
    });
  } catch (error) {
    logger.error('Financials error', { err: error.message });
    res.status(500).json({ error: 'Failed to fetch financials' });
  }
};

// ── Admin accounts ────────────────────────────────────────────────────────────

const getAdminAccounts = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, email, first_name, last_name, is_active, last_login_at, created_at
        FROM users WHERE role = 'admin' ORDER BY created_at ASC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch admin accounts' });
  }
};

const createAdminAccount = async (req, res) => {
  try {
    const { email, password, first_name, last_name } = req.body;
    if (!email || !password || !first_name) {
      return res.status(400).json({ error: 'email, password, and first_name are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const { rows: existing } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.length) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(password, 10);
    const id = uuidv4();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_active)
       VALUES ($1, $2, $3, $4, $5, 'admin', true)`,
      [id, email, passwordHash, first_name, last_name || null]
    );
    res.status(201).json({ id, message: 'Admin account created' });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    logger.error('createAdminAccount error', { err: err.message });
    res.status(500).json({ error: 'Failed to create admin account' });
  }
};

const deactivateAdminAccount = async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot deactivate your own account' });
    }
    const result = await pool.query(
      `UPDATE users SET is_active = false WHERE id = $1 AND role = 'admin' RETURNING id`,
      [req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Admin account not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to deactivate admin account' });
  }
};

const activateAdminAccount = async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE users SET is_active = true WHERE id = $1 AND role = 'admin' RETURNING id`,
      [req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Admin account not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to activate admin account' });
  }
};

module.exports = {
  getDashboard,
  getAnalytics,
  getFinancials,
  getTopProducts,
  getInventoryOverview,
  getAllCustomers,
  getAdminAccounts,
  createAdminAccount,
  deactivateAdminAccount,
  activateAdminAccount,
  uploadProductImages,
  deleteProductImage,
  reorderProductImages,
  setPrimaryProductImage,
};

const path   = require('path');
const fs     = require('fs');
const { v4: uuidv4 } = require('uuid');
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
    const [revenue, orders, customers, products, recentOrders] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(total_amount), 0) as total_revenue FROM orders WHERE payment_status = 'paid'`),
      pool.query('SELECT COUNT(*) FROM orders'),
      pool.query(`SELECT COUNT(*) FROM users WHERE role = 'customer'`),
      pool.query('SELECT COUNT(*) FROM products'),
      pool.query('SELECT id, order_number, total_amount, status, payment_status, created_at FROM orders ORDER BY created_at DESC LIMIT 10'),
    ]);

    res.json({
      totalRevenue: revenue.rows[0].total_revenue,
      totalOrders: orders.rows[0].count,
      totalCustomers: customers.rows[0].count,
      totalProducts: products.rows[0].count,
      recentOrders: recentOrders.rows,
    });
  } catch (error) {
    logger.error('Dashboard error', { err: error.message });
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
};

const getAnalytics = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT DATE(created_at) as date, COUNT(*) as orders, SUM(total_amount) as revenue
      FROM orders WHERE payment_status = 'paid'
      GROUP BY DATE(created_at)
      ORDER BY date DESC LIMIT 30
    `);
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
    const { rows } = await pool.query(`
      SELECT u.id, u.email, u.first_name, u.last_name, u.created_at,
             c.total_spent, c.total_orders
      FROM users u LEFT JOIN customers c ON u.id = c.user_id
      WHERE u.role = 'customer'
      ORDER BY u.created_at DESC
    `);
    res.json(rows);
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

module.exports = {
  getDashboard,
  getAnalytics,
  getTopProducts,
  getInventoryOverview,
  getAllCustomers,
  uploadProductImages,
  deleteProductImage,
  reorderProductImages,
  setPrimaryProductImage,
};

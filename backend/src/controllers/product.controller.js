const NodeCache = require('node-cache');
const pool = require('../config/database');
const ProductModel = require('../models/product.model');
const logger = require('../utils/logger');

// Bounded in-memory caches (maxKeys prevents arbitrary query-param memory exhaustion).
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60, maxKeys: 500 });
const suggestCache = new NodeCache({ stdTTL: 60, checkperiod: 60, maxKeys: 300 });

const ALLOWED_PRODUCT_QUERY_KEYS = [
  'category', 'brand', 'search', 'sort', 'limit', 'offset', 'page', 'min_price', 'max_price', 'in_stock',
  'skin_type', 'skin_concern', 'min_rating', 'on_sale',
];

function buildCanonicalProductKey(query = {}) {
  const normalized = {};
  for (const key of ALLOWED_PRODUCT_QUERY_KEYS) {
    if (query[key] !== undefined && query[key] !== '') {
      normalized[key] = String(query[key]).slice(0, 400);
    }
  }
  return `products:${JSON.stringify(normalized)}`;
}

function bustCache() {
  cache.flushAll();
  suggestCache.flushAll();
}

const getProducts = async (req, res) => {
  try {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    const cacheKey = buildCanonicalProductKey(req.query);
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const products = await ProductModel.findAll(req.query);
    try { cache.set(cacheKey, products); } catch { /* ignore when at maxKeys */ }
    res.json(products);
  } catch (error) {
    logger.error('Error fetching products', { err: error.message });
    res.status(500).json({ error: 'Failed to fetch products' });
  }
};

const suggestProducts = async (req, res) => {
  try {
    const raw = String(req.query.q || '').trim().slice(0, 60);
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    if (raw.length < 2) {
      return res.json({ products: [], categories: [] });
    }

    const key = `suggest:${raw.toLowerCase()}`;
    const cached = suggestCache.get(key);
    if (cached) return res.json(cached);

    const pattern = `%${raw}%`;
    const [prodRes, catRes] = await Promise.all([
      pool.query(
        `SELECT p.id, p.name, p.price, p.category,
                COALESCE(
                  (SELECT url FROM product_images WHERE product_id = p.id ORDER BY is_primary DESC, sort_order ASC LIMIT 1),
                  p.image_url
                ) AS image_url
           FROM products p
          WHERE p.is_active = TRUE
            AND (p.name ILIKE $1 OR p.category ILIKE $1)
          ORDER BY CASE WHEN p.name ILIKE $2 THEN 0 ELSE 1 END, p.created_at DESC
          LIMIT 6`,
        [pattern, `${raw}%`]
      ),
      pool.query(
        `SELECT DISTINCT category
           FROM products
          WHERE is_active = TRUE
            AND category IS NOT NULL
            AND category ILIKE $1
          ORDER BY category ASC
          LIMIT 4`,
        [pattern]
      ),
    ]);

    const payload = {
      products: prodRes.rows,
      categories: catRes.rows.map(r => r.category),
    };
    try { suggestCache.set(key, payload); } catch { /* at capacity */ }
    res.json(payload);
  } catch (error) {
    logger.error('Error fetching search suggestions', { err: error.message });
    res.status(500).json({ error: 'Failed to fetch suggestions' });
  }
};

const getProductById = async (req, res) => {
  try {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    const product = await ProductModel.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch product' });
  }
};

const getRelatedProducts = async (req, res) => {
  try {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    const { id } = req.params;
    const cacheKey = `products:related:${id}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);
    const related = await ProductModel.findRelated(id);
    try { cache.set(cacheKey, related); } catch { /* ignore when at maxKeys */ }
    res.json(related);
  } catch (error) {
    logger.error('Error fetching related products', { err: error.message });
    res.status(500).json({ error: 'Failed to fetch related products' });
  }
};

const createProduct = async (req, res) => {
  try {
    const id = await ProductModel.create(req.body);
    bustCache();
    const { logAdminAction } = require('../utils/audit');
    await logAdminAction({
      actorId: req.user?.id,
      actorEmail: req.userEmail,
      action: 'product.create',
      resourceType: 'product',
      resourceId: id,
      details: { name: req.body.name, price: req.body.price },
      ip: req.ip,
    });
    res.status(201).json({ id, message: 'Product created' });
  } catch (error) {
    logger.error('Error creating product', { err: error.message });
    res.status(500).json({ error: 'Failed to create product' });
  }
};

const updateProduct = async (req, res) => {
  try {
    const product = await ProductModel.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    await ProductModel.update(req.params.id, req.body);
    bustCache();
    const { logAdminAction } = require('../utils/audit');
    await logAdminAction({
      actorId: req.user?.id,
      actorEmail: req.userEmail,
      action: 'product.update',
      resourceType: 'product',
      resourceId: req.params.id,
      details: { name: req.body.name ?? product.name, old_price: product.price, new_price: req.body.price },
      ip: req.ip,
    });
    res.json({ message: 'Product updated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update product' });
  }
};

const deleteProduct = async (req, res) => {
  try {
    await ProductModel.delete(req.params.id);
    bustCache();
    const { logAdminAction } = require('../utils/audit');
    await logAdminAction({
      actorId: req.user?.id,
      actorEmail: req.userEmail,
      action: 'product.delete',
      resourceType: 'product',
      resourceId: req.params.id,
      details: {},
      ip: req.ip,
    });
    res.json({ message: 'Product deleted' });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Failed to delete product' });
  }
};

const getAdminProducts = async (req, res) => {
  try {
    const { category, brand, search, sort } = req.query;
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const result = await ProductModel.findAll({ category, brand, search, sort, limit, offset, includeInactive: true });
    res.json({
      data:       result.products,
      total:      result.total,
      page,
      limit,
      totalPages: Math.ceil(result.total / limit),
    });
  } catch (error) {
    logger.error('Error fetching admin products', { err: error.message });
    res.status(500).json({ error: 'Failed to fetch products' });
  }
};

const toggleProductVisibility = async (req, res) => {
  try {
    const { rows } = await require('../config/database').query(
      `UPDATE products SET is_active = NOT is_active, updated_at = NOW()
        WHERE id = $1 RETURNING id, is_active`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Product not found' });
    bustCache();
    res.json({ id: rows[0].id, is_active: rows[0].is_active });
  } catch (error) {
    res.status(500).json({ error: 'Failed to toggle product visibility' });
  }
};

const getCategories = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT TRIM(category) AS category, COUNT(*)::int AS count
       FROM products
       WHERE is_active = TRUE
         AND category IS NOT NULL
         AND TRIM(category) <> ''
       GROUP BY TRIM(category)
       ORDER BY TRIM(category) ASC`
    );
    res.json({
      categories: rows.map((r) => r.category),
      details: rows,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load categories' });
  }
};

const getBrands = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT TRIM(brand) AS brand, COUNT(*)::int AS count
       FROM products
       WHERE is_active = TRUE
         AND brand IS NOT NULL
         AND TRIM(brand) <> ''
       GROUP BY TRIM(brand)
       ORDER BY TRIM(brand) ASC`
    );
    res.json({
      brands: rows.map((r) => r.brand),
      details: rows,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load brands' });
  }
};

// Context-aware facets for /shop sidebar (scoped brand/category counts + live price bounds)
const getFacets = async (req, res) => {
  try {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    const { category, search, in_stock, on_sale } = req.query;
    const cacheKey = `facets:${JSON.stringify({ category: category || '', search: search || '', in_stock: in_stock || '', on_sale: on_sale || '' })}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const buildBaseWhere = ({ includeCategory = true } = {}) => {
      const params = [];
      const clauses = ['p.is_active = TRUE'];
      if (includeCategory && category) {
        params.push(String(category).trim());
        clauses.push(`p.category = $${params.length}`);
      }
      if (search && String(search).trim()) {
        params.push(`%${String(search).trim()}%`);
        clauses.push(`(p.name ILIKE $${params.length} OR p.brand ILIKE $${params.length} OR p.description ILIKE $${params.length})`);
      }
      if (in_stock === 'true' || in_stock === true) {
        clauses.push('p.stock_quantity > 0');
      }
      if (on_sale === 'true' || on_sale === true) {
        clauses.push(
          `((p.compare_at_price IS NOT NULL AND p.compare_at_price > p.price) OR EXISTS (
            SELECT 1 FROM promotions promo
            WHERE promo.is_active = TRUE
              AND promo.starts_at <= NOW()
              AND promo.ends_at   >= NOW()
              AND (
                promo.applies_to = 'all'
                OR (promo.applies_to = 'category' AND promo.category = p.category)
                OR (promo.applies_to = 'product'  AND promo.product_id = p.id)
              )
          ))`
        );
      }
      return { where: `WHERE ${clauses.join(' AND ')}`, params };
    };

    const catScope   = buildBaseWhere({ includeCategory: false });
    const brandScope = buildBaseWhere({ includeCategory: true });

    const [catRes, brandRes, priceRes, skinRes] = await Promise.all([
      pool.query(
        `SELECT TRIM(p.category) AS category, COUNT(*)::int AS count
           FROM products p ${catScope.where}
            AND p.category IS NOT NULL AND TRIM(p.category) <> ''
          GROUP BY TRIM(p.category)
          ORDER BY count DESC, TRIM(p.category) ASC`,
        catScope.params
      ),
      pool.query(
        `SELECT TRIM(p.brand) AS brand, COUNT(*)::int AS count
           FROM products p ${brandScope.where}
            AND p.brand IS NOT NULL AND TRIM(p.brand) <> ''
          GROUP BY TRIM(p.brand)
          ORDER BY count DESC, TRIM(p.brand) ASC`,
        brandScope.params
      ),
      pool.query(
        `SELECT COALESCE(FLOOR(MIN(p.price)), 0)::int AS min_price,
                COALESCE(CEIL(MAX(p.price)), 1000)::int AS max_price
           FROM products p ${brandScope.where}`,
        brandScope.params
      ),
      pool.query(
        `SELECT LOWER(TRIM(st)) AS value, COUNT(*)::int AS count
           FROM products p, LATERAL unnest(COALESCE(p.skin_types, '{}'::text[])) AS st
          ${brandScope.where} AND TRIM(st) <> ''
          GROUP BY LOWER(TRIM(st))
          ORDER BY count DESC, value ASC`,
        brandScope.params
      ),
    ]);

    const payload = {
      categories: catRes.rows,
      brands:     brandRes.rows,
      price: {
        min: priceRes.rows[0]?.min_price ?? 0,
        max: priceRes.rows[0]?.max_price ?? 1000,
      },
      skin_types: skinRes.rows,
    };
    try { cache.set(cacheKey, payload, 180); } catch { /* ignore */ }
    res.json(payload);
  } catch (err) {
    logger.error('getFacets error', { err: err.message });
    res.status(500).json({ error: 'Failed to load facets' });
  }
};

const bulkImportProducts = async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (items.length === 0) {
    return res.status(400).json({ error: 'No product items provided.' });
  }
  if (items.length > 200) {
    return res.status(400).json({ error: 'Maximum 200 products per import batch.' });
  }

  const client = await pool.connect();
  let imported = 0;
  let skipped = 0;
  const errors = [];

  try {
    await client.query('BEGIN');
    for (let i = 0; i < items.length; i++) {
      const row = items[i] || {};
      const name = String(row.name || '').trim();
      const price = Number(row.price);
      if (!name || !Number.isFinite(price) || price < 0) {
        skipped++;
        errors.push(`Row ${i + 1}: Missing valid name or price`);
        continue;
      }

      const sku = row.sku ? String(row.sku).trim() : null;
      if (sku) {
        const dup = await client.query('SELECT id FROM products WHERE sku = $1 LIMIT 1', [sku]);
        if (dup.rows.length > 0) {
          skipped++;
          errors.push(`Row ${i + 1} (${sku}): SKU already exists`);
          continue;
        }
      }

      const id = require('crypto').randomUUID();
      await client.query(
        `INSERT INTO products
           (id, name, price, compare_at_price, cost, category, brand,
            description, image_url, stock_quantity, sku,
            ingredients, usage_instructions, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          id,
          name,
          price,
          row.compare_at_price !== undefined && row.compare_at_price !== '' ? Number(row.compare_at_price) : null,
          row.cost !== undefined && row.cost !== '' ? Number(row.cost) : null,
          row.category ? String(row.category).trim() : 'Skincare',
          row.brand ? String(row.brand).trim() : null,
          row.description ? String(row.description).trim() : '',
          row.image_url ? String(row.image_url).trim() : null,
          Math.max(0, parseInt(row.stock_quantity, 10) || 0),
          sku,
          row.ingredients ? String(row.ingredients).trim() : null,
          row.usage_instructions ? String(row.usage_instructions).trim() : null,
          row.is_active !== false && row.is_active !== 'false',
        ]
      );
      imported++;
    }
    await client.query('COMMIT');
    bustCache();
    res.status(201).json({ imported, skipped, errors: errors.slice(0, 10) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('bulkImportProducts error', { err: err.message });
    res.status(500).json({ error: 'Bulk import failed.' });
  } finally {
    client.release();
  }
};

module.exports = {
  getProducts, suggestProducts, getCategories, getBrands, getFacets, getProductById,
  getRelatedProducts, createProduct, updateProduct, deleteProduct,
  getAdminProducts, toggleProductVisibility, bulkImportProducts, bustCache,
};

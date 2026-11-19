const NodeCache = require('node-cache');
const pool = require('../config/database');
const ProductModel = require('../models/product.model');
const logger = require('../utils/logger');

// Bounded in-memory caches (maxKeys prevents arbitrary query-param memory exhaustion).
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60, maxKeys: 500 });
const suggestCache = new NodeCache({ stdTTL: 60, checkperiod: 60, maxKeys: 300 });

const ALLOWED_PRODUCT_QUERY_KEYS = [
  'category', 'search', 'sort', 'limit', 'offset', 'page', 'min_price', 'max_price', 'in_stock',
];

function buildCanonicalProductKey(query = {}) {
  const normalized = {};
  for (const key of ALLOWED_PRODUCT_QUERY_KEYS) {
    if (query[key] !== undefined && query[key] !== '') {
      normalized[key] = String(query[key]).slice(0, 120);
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
    res.status(201).json({ id, message: 'Product created' });
  } catch (error) {
    if (error.code === '23505' && error.constraint === 'products_sku_key') {
      const skuVal = req.body.sku || '';
      return res.status(409).json({
        error: `The SKU '${skuVal}' is already assigned to another product. Please enter a unique SKU.`,
        errors: [{ field: 'sku', message: `The SKU '${skuVal}' is already assigned to another product. Please enter a unique SKU.` }],
      });
    }
    logger.error('Error creating product', { err: error.message });
    res.status(500).json({ error: 'Failed to create product' });
  }
};

const updateProduct = async (req, res) => {
  try {
    const product = await ProductModel.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    // Validate compare_at_price against effective selling price
    const effectivePrice = req.body.price !== undefined ? req.body.price : Number(product.price);
    const effectiveCompareAt = req.body.compare_at_price !== undefined
      ? req.body.compare_at_price
      : (product.compare_at_price != null ? Number(product.compare_at_price) : null);

    if (effectiveCompareAt !== null && effectiveCompareAt > 0 && effectiveCompareAt <= effectivePrice) {
      return res.status(400).json({
        error: 'Validation failed',
        errors: [{ field: 'compare_at_price', message: 'Compare at price must be greater than the selling price.' }],
      });
    }

    // Merge existing values for omitted fields in partial update
    const updatePayload = {
      name:               req.body.name !== undefined ? req.body.name : product.name,
      price:              req.body.price !== undefined ? req.body.price : product.price,
      cost:               req.body.cost !== undefined ? req.body.cost : product.cost,
      compare_at_price:   req.body.compare_at_price !== undefined ? req.body.compare_at_price : product.compare_at_price,
      stock_quantity:     req.body.stock_quantity !== undefined ? req.body.stock_quantity : product.stock_quantity,
      category:           req.body.category !== undefined ? req.body.category : product.category,
      brand:              req.body.brand !== undefined ? req.body.brand : product.brand,
      description:        req.body.description !== undefined ? req.body.description : product.description,
      image_url:          req.body.image_url !== undefined ? req.body.image_url : product.image_url,
      ingredients:        req.body.ingredients !== undefined ? req.body.ingredients : product.ingredients,
      usage_instructions: req.body.usage_instructions !== undefined ? req.body.usage_instructions : product.usage_instructions,
      is_active:          req.body.is_active !== undefined ? req.body.is_active : product.is_active,
      sku:                req.body.sku !== undefined ? req.body.sku : product.sku,
    };

    await ProductModel.update(req.params.id, updatePayload);
    bustCache();
    res.json({ message: 'Product updated' });
  } catch (error) {
    if (error.code === '23505' && error.constraint === 'products_sku_key') {
      const skuVal = req.body.sku || '';
      return res.status(409).json({
        error: `The SKU '${skuVal}' is already assigned to another product. Please enter a unique SKU.`,
        errors: [{ field: 'sku', message: `The SKU '${skuVal}' is already assigned to another product. Please enter a unique SKU.` }],
      });
    }
    logger.error('Error updating product', { err: error.message });
    res.status(500).json({ error: 'Failed to update product' });
  }
};

const deleteProduct = async (req, res) => {
  try {
    await ProductModel.delete(req.params.id);
    bustCache();
    res.json({ message: 'Product deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete product' });
  }
};

const getAdminProducts = async (req, res) => {
  try {
    const { category, search, sort } = req.query;
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const result = await ProductModel.findAll({ category, search, sort, limit, offset, includeInactive: true });
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

module.exports = { getProducts, suggestProducts, getProductById, getRelatedProducts, createProduct, updateProduct, deleteProduct, getAdminProducts, toggleProductVisibility, bustCache };

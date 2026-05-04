const NodeCache = require('node-cache');
const ProductModel = require('../models/product.model');
const logger = require('../utils/logger');

// In-memory cache with 5-minute TTL. Works on any server, zero infrastructure.
// For multi-server deployments, swap this for pg-boss-powered invalidation or a shared cache.
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

function bustCache() {
  const keys = cache.keys().filter(k => k.startsWith('products:'));
  if (keys.length) cache.del(keys);
}

const getProducts = async (req, res) => {
  try {
    const cacheKey = `products:${JSON.stringify(req.query)}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const products = await ProductModel.findAll(req.query);
    cache.set(cacheKey, products);
    res.json(products);
  } catch (error) {
    logger.error('Error fetching products', { err: error.message });
    res.status(500).json({ error: 'Failed to fetch products' });
  }
};

const getProductById = async (req, res) => {
  try {
    const product = await ProductModel.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch product' });
  }
};

const getRelatedProducts = async (req, res) => {
  try {
    const { id } = req.params;
    const cacheKey = `products:related:${id}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);
    const related = await ProductModel.findRelated(id);
    cache.set(cacheKey, related);
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
    res.json({ message: 'Product updated' });
  } catch (error) {
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

module.exports = { getProducts, getProductById, getRelatedProducts, createProduct, updateProduct, deleteProduct, getAdminProducts, toggleProductVisibility };

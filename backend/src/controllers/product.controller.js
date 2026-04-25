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

module.exports = { getProducts, getProductById, createProduct, updateProduct, deleteProduct };

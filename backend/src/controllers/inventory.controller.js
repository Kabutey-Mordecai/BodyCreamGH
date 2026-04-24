const InventoryModel = require('../models/inventory.model');
const ProductModel = require('../models/product.model');

const getInventory = async (req, res) => {
  try {
    res.json(await InventoryModel.getAll());
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch inventory' });
  }
};

const restockProduct = async (req, res) => {
  try {
    const { product_id, quantity, notes } = req.body;

    if (!product_id || !quantity || parseInt(quantity) <= 0) {
      return res.status(400).json({ error: 'product_id and a positive quantity are required' });
    }

    const product = await ProductModel.findById(product_id);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    await InventoryModel.adjustStock(product_id, parseInt(quantity), 'restock', notes || null);

    res.json({ message: `Restocked ${quantity} units of "${product.name}"` });
  } catch (error) {
    console.error('Restock error:', error);
    res.status(500).json({ error: 'Failed to restock product' });
  }
};

const getHistory = async (req, res) => {
  try {
    const { productId } = req.params;
    const { limit } = req.query;
    res.json(await InventoryModel.getHistory(productId || null, limit || 50));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch inventory history' });
  }
};

const getLowStock = async (req, res) => {
  try {
    const threshold = parseInt(req.query.threshold) || 10;
    res.json(await InventoryModel.getLowStock(threshold));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch low-stock products' });
  }
};

module.exports = { getInventory, restockProduct, getHistory, getLowStock };

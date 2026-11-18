'use strict';

const VariantModel = require('../models/variant.model');
const { bustCache } = require('./product.controller');
const logger = require('../utils/logger');

// GET /api/products/:id/variants
// Public — no auth needed. Admin gets all variants; customers get is_active=TRUE only.
const getVariants = async (req, res) => {
  try {
    const isAdmin = req.user?.role === 'admin';
    const data = await VariantModel.findByProduct(req.params.id, { activeOnly: !isAdmin });
    res.json(data);
  } catch (err) {
    logger.error('getVariants error', { err: err.message });
    res.status(500).json({ error: 'Failed to fetch variants' });
  }
};

// POST /api/products/:id/variants  (admin)
const createVariant = async (req, res) => {
  try {
    const { price, stock_quantity } = req.body;
    if (!price || isNaN(Number(price)) || Number(price) < 0) {
      return res.status(400).json({ error: 'price must be a non-negative number' });
    }
    const id = await VariantModel.create(req.params.id, req.body);
    const variant = await VariantModel.findById(id);
    bustCache();
    res.status(201).json(variant);
  } catch (err) {
    logger.error('createVariant error', { err: err.message });
    res.status(500).json({ error: 'Failed to create variant' });
  }
};

// PUT /api/products/:id/variants/:variantId  (admin)
const updateVariant = async (req, res) => {
  try {
    const { price } = req.body;
    if (price !== undefined && (isNaN(Number(price)) || Number(price) < 0)) {
      return res.status(400).json({ error: 'price must be a non-negative number' });
    }
    await VariantModel.update(req.params.variantId, req.body);
    const variant = await VariantModel.findById(req.params.variantId);
    if (!variant) return res.status(404).json({ error: 'Variant not found' });
    bustCache();
    res.json(variant);
  } catch (err) {
    logger.error('updateVariant error', { err: err.message });
    res.status(500).json({ error: 'Failed to update variant' });
  }
};

// DELETE /api/products/:id/variants/:variantId  (admin — soft delete)
const deleteVariant = async (req, res) => {
  try {
    await VariantModel.delete(req.params.variantId);
    bustCache();
    res.json({ message: 'Variant deactivated' });
  } catch (err) {
    logger.error('deleteVariant error', { err: err.message });
    res.status(500).json({ error: 'Failed to deactivate variant' });
  }
};

// POST /api/products/:id/option-types  (admin)
const createOptionType = async (req, res) => {
  try {
    const { name, position } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    const id = await VariantModel.createOptionType(req.params.id, name.trim(), position ?? 0);
    res.status(201).json({ id, name: name.trim(), position: position ?? 0, values: [] });
  } catch (err) {
    logger.error('createOptionType error', { err: err.message });
    res.status(500).json({ error: 'Failed to create option type' });
  }
};

// DELETE /api/products/:id/option-types/:typeId  (admin — cascades to values + variants)
const deleteOptionType = async (req, res) => {
  try {
    await VariantModel.deleteOptionType(req.params.typeId);
    res.json({ message: 'Option type deleted' });
  } catch (err) {
    logger.error('deleteOptionType error', { err: err.message });
    res.status(500).json({ error: 'Failed to delete option type' });
  }
};

// POST /api/products/:id/option-types/:typeId/values  (admin)
const createOptionValue = async (req, res) => {
  try {
    const { value, position } = req.body;
    if (!value?.trim()) return res.status(400).json({ error: 'value is required' });
    const id = await VariantModel.createOptionValue(req.params.typeId, req.params.id, value.trim(), position ?? 0);
    res.status(201).json({ id, value: value.trim(), position: position ?? 0 });
  } catch (err) {
    logger.error('createOptionValue error', { err: err.message });
    res.status(500).json({ error: 'Failed to create option value' });
  }
};

// DELETE /api/products/:id/option-values/:valueId  (admin)
const deleteOptionValue = async (req, res) => {
  try {
    await VariantModel.deleteOptionValue(req.params.valueId);
    res.json({ message: 'Option value deleted' });
  } catch (err) {
    logger.error('deleteOptionValue error', { err: err.message });
    res.status(500).json({ error: 'Failed to delete option value' });
  }
};

module.exports = {
  getVariants, createVariant, updateVariant, deleteVariant,
  createOptionType, deleteOptionType, createOptionValue, deleteOptionValue,
};

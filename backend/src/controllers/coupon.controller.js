const CouponModel = require('../models/coupon.model');
const pool = require('../config/database');
const logger = require('../utils/logger');

const validateCoupon = async (req, res) => {
  try {
    const { code, orderTotal } = req.body;
    if (!code || orderTotal == null) {
      return res.status(400).json({ error: 'code and orderTotal are required.' });
    }
    const result = await CouponModel.validate(code, orderTotal);
    if (!result.valid) return res.status(400).json({ error: result.error });

    res.json({
      valid: true,
      code:           result.coupon.code,
      type:           result.coupon.type,
      value:          parseFloat(result.coupon.value),
      discountAmount: result.discountAmount,
    });
  } catch (err) {
    logger.error('Validate coupon error', { err: err.message });
    res.status(500).json({ error: 'Failed to validate coupon.' });
  }
};

const getAllCoupons = async (req, res) => {
  try {
    res.json(await CouponModel.findAll());
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch coupons.' });
  }
};

const createCoupon = async (req, res) => {
  try {
    const { code, type, value, min_order, max_uses, expires_at } = req.body;
    if (!code || !type || value == null) {
      return res.status(400).json({ error: 'code, type, and value are required.' });
    }
    if (!['percentage', 'fixed'].includes(type)) {
      return res.status(400).json({ error: 'type must be "percentage" or "fixed".' });
    }
    if (type === 'percentage' && (parseFloat(value) < 1 || parseFloat(value) > 100)) {
      return res.status(400).json({ error: 'Percentage value must be between 1 and 100.' });
    }
    const coupon = await CouponModel.create({ code, type, value, min_order, max_uses, expires_at });
    res.status(201).json(coupon);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A coupon with this code already exists.' });
    }
    logger.error('Create coupon error', { err: err.message });
    res.status(500).json({ error: 'Failed to create coupon.' });
  }
};

const updateCoupon = async (req, res) => {
  try {
    const { code, type, value, min_order, max_uses, expires_at, active } = req.body;
    if (!code || !type || value == null) {
      return res.status(400).json({ error: 'code, type, and value are required.' });
    }
    if (!['percentage', 'fixed'].includes(type)) {
      return res.status(400).json({ error: 'type must be "percentage" or "fixed".' });
    }
    if (type === 'percentage' && (parseFloat(value) < 1 || parseFloat(value) > 100)) {
      return res.status(400).json({ error: 'Percentage value must be between 1 and 100.' });
    }
    // Ensure no other coupon uses this code
    const { rows } = await pool.query(
      `SELECT id FROM coupons WHERE UPPER(code) = UPPER($1) AND id != $2`,
      [code, req.params.id]
    );
    if (rows.length) return res.status(409).json({ error: 'A coupon with this code already exists.' });

    const updated = await CouponModel.update(req.params.id, { code, type, value, min_order, max_uses, expires_at, active });
    if (!updated) return res.status(404).json({ error: 'Coupon not found.' });
    res.json(updated);
  } catch (err) {
    logger.error('Update coupon error', { err: err.message });
    res.status(500).json({ error: 'Failed to update coupon.' });
  }
};

const deactivateCoupon = async (req, res) => {
  try {
    await CouponModel.deactivate(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to deactivate coupon.' });
  }
};

const deleteCoupon = async (req, res) => {
  try {
    await CouponModel.remove(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete coupon.' });
  }
};

module.exports = { validateCoupon, getAllCoupons, createCoupon, updateCoupon, deactivateCoupon, deleteCoupon };

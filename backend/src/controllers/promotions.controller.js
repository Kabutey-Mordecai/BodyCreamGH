'use strict';

const pool   = require('../config/database');
const logger = require('../utils/logger');

// ── Public ────────────────────────────────────────────────────────────────────

const getActivePromotions = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, discount_type, discount_value,
              applies_to, category, product_id, starts_at, ends_at
       FROM promotions
       WHERE is_active = TRUE
         AND starts_at <= NOW()
         AND ends_at   >= NOW()
       ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    logger.error('Get active promotions error', { err: err.message });
    res.status(500).json({ error: 'Failed to fetch promotions.' });
  }
};

// ── Admin ─────────────────────────────────────────────────────────────────────

const getPromotions = async (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page  || '1',  10));
  const limit  = Math.min(100, parseInt(req.query.limit || '20', 10));
  const offset = (page - 1) * limit;

  try {
    const [listRes, countRes] = await Promise.all([
      pool.query(
        `SELECT p.*, pr.name AS product_name
         FROM promotions p
         LEFT JOIN products pr ON pr.id = p.product_id
         ORDER BY p.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      pool.query('SELECT COUNT(*) FROM promotions'),
    ]);
    const total = parseInt(countRes.rows[0].count, 10);
    res.json({
      data: listRes.rows, total, page, limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    logger.error('Get promotions error', { err: err.message });
    res.status(500).json({ error: 'Failed to fetch promotions.' });
  }
};

const createPromotion = async (req, res) => {
  const {
    name, discount_type, discount_value,
    applies_to = 'all', category, product_id,
    starts_at, ends_at,
  } = req.body;

  if (!name?.trim())
    return res.status(400).json({ error: 'Name is required.' });
  if (!['percentage', 'fixed'].includes(discount_type))
    return res.status(400).json({ error: 'discount_type must be "percentage" or "fixed".' });
  if (!discount_value || Number(discount_value) <= 0)
    return res.status(400).json({ error: 'discount_value must be a positive number.' });
  if (!['all', 'category', 'product'].includes(applies_to))
    return res.status(400).json({ error: 'Invalid applies_to value.' });
  if (!starts_at || !ends_at)
    return res.status(400).json({ error: 'starts_at and ends_at are required.' });
  if (new Date(ends_at) <= new Date(starts_at))
    return res.status(400).json({ error: 'ends_at must be after starts_at.' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO promotions
         (name, discount_type, discount_value, applies_to, category, product_id, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        name.trim(), discount_type, Number(discount_value), applies_to,
        category || null, product_id || null, starts_at, ends_at,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error('Create promotion error', { err: err.message });
    res.status(500).json({ error: 'Failed to create promotion.' });
  }
};

const updatePromotion = async (req, res) => {
  const { id } = req.params;
  const {
    name, discount_type, discount_value,
    applies_to = 'all', category, product_id,
    starts_at, ends_at,
  } = req.body;

  if (!name?.trim())
    return res.status(400).json({ error: 'Name is required.' });
  if (!['percentage', 'fixed'].includes(discount_type))
    return res.status(400).json({ error: 'Invalid discount_type.' });
  if (!discount_value || Number(discount_value) <= 0)
    return res.status(400).json({ error: 'discount_value must be positive.' });
  if (!starts_at || !ends_at)
    return res.status(400).json({ error: 'starts_at and ends_at are required.' });
  if (new Date(ends_at) <= new Date(starts_at))
    return res.status(400).json({ error: 'ends_at must be after starts_at.' });

  try {
    const { rowCount, rows } = await pool.query(
      `UPDATE promotions
       SET name=$1, discount_type=$2, discount_value=$3, applies_to=$4,
           category=$5, product_id=$6, starts_at=$7, ends_at=$8
       WHERE id=$9
       RETURNING *`,
      [
        name.trim(), discount_type, Number(discount_value), applies_to,
        category || null, product_id || null, starts_at, ends_at, id,
      ]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Promotion not found.' });
    res.json(rows[0]);
  } catch (err) {
    logger.error('Update promotion error', { err: err.message });
    res.status(500).json({ error: 'Failed to update promotion.' });
  }
};

const togglePromotion = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows, rowCount } = await pool.query(
      `UPDATE promotions SET is_active = NOT is_active
       WHERE id = $1 RETURNING id, is_active`,
      [id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Promotion not found.' });
    res.json({ id: rows[0].id, is_active: rows[0].is_active });
  } catch (err) {
    logger.error('Toggle promotion error', { err: err.message });
    res.status(500).json({ error: 'Failed to toggle promotion.' });
  }
};

const deletePromotion = async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await pool.query('DELETE FROM promotions WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Promotion not found.' });
    res.json({ success: true });
  } catch (err) {
    logger.error('Delete promotion error', { err: err.message });
    res.status(500).json({ error: 'Failed to delete promotion.' });
  }
};

module.exports = {
  getActivePromotions,
  getPromotions, createPromotion, updatePromotion, togglePromotion, deletePromotion,
};

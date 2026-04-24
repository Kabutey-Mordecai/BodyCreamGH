const pool = require('../config/database');

module.exports = {
  findByProduct: async (productId) => {
    const { rows } = await pool.query(
      `SELECT r.id, r.rating, r.title, r.body, r.created_at,
              u.first_name, u.last_name
       FROM product_reviews r
       JOIN users u ON r.user_id = u.id
       WHERE r.product_id = $1
       ORDER BY r.created_at DESC`,
      [productId]
    );
    return rows;
  },

  getStats: async (productId) => {
    const { rows } = await pool.query(
      `SELECT ROUND(AVG(rating)::numeric, 1) AS avg_rating,
              COUNT(*) AS review_count
       FROM product_reviews WHERE product_id = $1`,
      [productId]
    );
    return rows[0];
  },

  hasPurchased: async (userId, productId) => {
    const { rows } = await pool.query(
      `SELECT 1 FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE o.customer_id = $1
         AND oi.product_id = $2
         AND o.payment_status = 'paid'
       LIMIT 1`,
      [userId, productId]
    );
    return rows.length > 0;
  },

  findByUser: async (userId, productId) => {
    const { rows } = await pool.query(
      'SELECT id FROM product_reviews WHERE user_id=$1 AND product_id=$2',
      [userId, productId]
    );
    return rows[0] || null;
  },

  create: async (productId, userId, { rating, title, body }) => {
    const { rows } = await pool.query(
      `INSERT INTO product_reviews (product_id, user_id, rating, title, body)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [productId, userId, rating, title || null, body || null]
    );
    return rows[0].id;
  },

  remove: async (id) => {
    await pool.query('DELETE FROM product_reviews WHERE id=$1', [id]);
  },

  findAll: async ({ limit = 50, offset = 0 } = {}) => {
    const { rows } = await pool.query(
      `SELECT r.id, r.rating, r.title, r.body, r.created_at,
              u.first_name, u.last_name, u.email,
              p.name AS product_name, p.id AS product_id
       FROM product_reviews r
       JOIN users u ON r.user_id = u.id
       JOIN products p ON r.product_id = p.id
       ORDER BY r.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return rows;
  },
};

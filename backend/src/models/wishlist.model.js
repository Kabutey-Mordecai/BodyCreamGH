const pool = require('../config/database');

const WishlistModel = {
  async findByUser(userId) {
    const { rows } = await pool.query(
      `SELECT w.id, w.product_id, w.created_at,
              p.name, p.price, p.image_url, p.stock_quantity,
              COALESCE(AVG(pr.rating), 0)::numeric(3,2) AS avg_rating,
              COUNT(pr.id) AS review_count
         FROM wishlists w
         JOIN products p  ON p.id = w.product_id
    LEFT JOIN product_reviews pr ON pr.product_id = p.id
        WHERE w.user_id = $1
     GROUP BY w.id, w.product_id, w.created_at, p.name, p.price, p.image_url, p.stock_quantity
     ORDER BY w.created_at DESC`,
      [userId]
    );
    return rows;
  },

  async exists(userId, productId) {
    const { rows } = await pool.query(
      'SELECT 1 FROM wishlists WHERE user_id=$1 AND product_id=$2',
      [userId, productId]
    );
    return rows.length > 0;
  },

  async add(userId, productId) {
    const { rows } = await pool.query(
      `INSERT INTO wishlists (user_id, product_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, product_id) DO NOTHING
       RETURNING id`,
      [userId, productId]
    );
    return rows[0];
  },

  async remove(userId, productId) {
    await pool.query(
      'DELETE FROM wishlists WHERE user_id=$1 AND product_id=$2',
      [userId, productId]
    );
  },

  async getProductIds(userId) {
    const { rows } = await pool.query(
      'SELECT product_id FROM wishlists WHERE user_id=$1',
      [userId]
    );
    return rows.map(r => r.product_id);
  },
};

module.exports = WishlistModel;

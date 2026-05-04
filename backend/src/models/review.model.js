'use strict';

const pool = require('../config/database');

const ReviewModel = {
  // Public paginated list — approved reviews only
  findByProduct: async (productId, { approvedOnly = true, page = 1, limit = 10, sort = 'recent' } = {}) => {
    const offset = (page - 1) * limit;

    const orderMap = {
      helpful:  'r.helpful_count DESC, r.created_at DESC',
      highest:  'r.rating DESC, r.created_at DESC',
      lowest:   'r.rating ASC, r.created_at DESC',
      recent:   'r.created_at DESC',
    };
    const orderClause = orderMap[sort] || orderMap.recent;
    const approvedWhere = approvedOnly ? 'AND r.is_approved = TRUE' : '';

    const { rows } = await pool.query(
      `SELECT r.id, r.rating, r.title, r.body, r.helpful_count, r.created_at,
              u.first_name,
              LEFT(u.last_name, 1) AS last_initial,
              TRUE AS verified_purchase
       FROM product_reviews r
       JOIN users u ON r.user_id = u.id
       WHERE r.product_id = $1 ${approvedWhere}
       ORDER BY ${orderClause}
       LIMIT $2 OFFSET $3`,
      [productId, limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM product_reviews r
       WHERE r.product_id = $1 ${approvedWhere}`,
      [productId]
    );

    return { rows, total: countResult.rows[0].total };
  },

  findByUser: async (userId) => {
    const { rows } = await pool.query(
      `SELECT r.id, r.rating, r.title, r.body,
              r.is_approved, r.is_rejected, r.created_at,
              p.name AS product_name, p.id AS product_id, p.image_url
       FROM product_reviews r
       JOIN products p ON r.product_id = p.id
       WHERE r.user_id = $1
       ORDER BY r.created_at DESC`,
      [userId]
    );
    return rows;
  },

  // Returns { can_review, already_reviewed, order_id }
  canUserReview: async (userId, productId) => {
    const existing = await pool.query(
      `SELECT id FROM product_reviews WHERE user_id = $1 AND product_id = $2`,
      [userId, productId]
    );
    if (existing.rows.length > 0) {
      return { can_review: false, already_reviewed: true, order_id: null };
    }

    const delivered = await pool.query(
      `SELECT o.id
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE o.customer_id = $1
         AND oi.product_id = $2
         AND o.status = 'delivered'
       LIMIT 1`,
      [userId, productId]
    );

    if (!delivered.rows.length) {
      return { can_review: false, already_reviewed: false, order_id: null };
    }

    return { can_review: true, already_reviewed: false, order_id: delivered.rows[0].id };
  },

  create: async ({ product_id, user_id, order_id, rating, title, body }) => {
    const { rows } = await pool.query(
      `INSERT INTO product_reviews (product_id, user_id, order_id, rating, title, body)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [product_id, user_id, order_id || null, rating, title || null, body || null]
    );
    return rows[0].id;
  },

  approve: async (reviewId) => {
    const { rows } = await pool.query(
      `UPDATE product_reviews
       SET is_approved = TRUE, is_rejected = FALSE, updated_at = NOW()
       WHERE id = $1
       RETURNING product_id`,
      [reviewId]
    );
    if (rows.length) {
      await ReviewModel.recalculateProductRating(rows[0].product_id);
    }
  },

  reject: async (reviewId, reason) => {
    await pool.query(
      `UPDATE product_reviews
       SET is_rejected = TRUE, is_approved = FALSE,
           rejection_reason = $2, updated_at = NOW()
       WHERE id = $1`,
      [reviewId, reason || null]
    );
  },

  delete: async (reviewId) => {
    const { rows } = await pool.query(
      `DELETE FROM product_reviews WHERE id = $1 RETURNING product_id`,
      [reviewId]
    );
    if (rows.length) {
      await ReviewModel.recalculateProductRating(rows[0].product_id);
    }
  },

  markHelpful: async (reviewId) => {
    await pool.query(
      `UPDATE product_reviews SET helpful_count = helpful_count + 1 WHERE id = $1`,
      [reviewId]
    );
  },

  recalculateProductRating: async (productId) => {
    await pool.query(
      `UPDATE products
       SET avg_rating = COALESCE((
             SELECT ROUND(AVG(rating)::numeric, 2)
             FROM product_reviews
             WHERE product_id = $1 AND is_approved = TRUE
           ), 0),
           review_count = (
             SELECT COUNT(*)::int
             FROM product_reviews
             WHERE product_id = $1 AND is_approved = TRUE
           )
       WHERE id = $1`,
      [productId]
    );
  },

  getDistribution: async (productId) => {
    const { rows } = await pool.query(
      `SELECT rating, COUNT(*)::int AS count
       FROM product_reviews
       WHERE product_id = $1 AND is_approved = TRUE
       GROUP BY rating`,
      [productId]
    );
    const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    rows.forEach(r => { dist[r.rating] = r.count; });
    return dist;
  },

  getSummary: async (productId) => {
    const { rows } = await pool.query(
      `SELECT ROUND(AVG(rating)::numeric, 2) AS avg_rating,
              COUNT(*)::int AS review_count
       FROM product_reviews
       WHERE product_id = $1 AND is_approved = TRUE`,
      [productId]
    );
    return rows[0];
  },

  // Admin: paginated list with filters
  findAll: async ({ status = 'pending', page = 1, limit = 20, search = '' } = {}) => {
    const offset = (page - 1) * limit;

    let statusClause;
    if (status === 'pending')  statusClause = 'r.is_approved = FALSE AND r.is_rejected = FALSE';
    else if (status === 'approved') statusClause = 'r.is_approved = TRUE';
    else if (status === 'rejected') statusClause = 'r.is_rejected = TRUE';
    else statusClause = '1=1';

    const params = [];
    let searchClause = '';
    if (search) {
      params.push(`%${search}%`);
      searchClause = `AND (p.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`;
    }

    params.push(limit, offset);
    const limitIdx  = params.length - 1;
    const offsetIdx = params.length;

    const { rows } = await pool.query(
      `SELECT r.id, r.rating, r.title, r.body,
              r.is_approved, r.is_rejected, r.rejection_reason,
              r.helpful_count, r.created_at,
              u.first_name, u.last_name, u.email,
              p.name AS product_name, p.id AS product_id, p.image_url
       FROM product_reviews r
       JOIN users u ON r.user_id = u.id
       JOIN products p ON r.product_id = p.id
       WHERE ${statusClause} ${searchClause}
       ORDER BY r.created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    );

    const countParams = search ? [`%${search}%`] : [];
    const countSearch = search ? `AND (p.name ILIKE $1 OR u.email ILIKE $1)` : '';
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM product_reviews r
       JOIN users u ON r.user_id = u.id
       JOIN products p ON r.product_id = p.id
       WHERE ${statusClause} ${countSearch}`,
      countParams
    );

    return { rows, total: countResult.rows[0].total };
  },

  getStatusCounts: async () => {
    const { rows } = await pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE is_approved = FALSE AND is_rejected = FALSE)::int AS pending,
        COUNT(*) FILTER (WHERE is_approved = TRUE)::int AS approved,
        COUNT(*) FILTER (WHERE is_rejected = TRUE)::int AS rejected
       FROM product_reviews`
    );
    return rows[0];
  },
};

module.exports = ReviewModel;

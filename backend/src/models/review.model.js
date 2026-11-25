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
              r.admin_reply, r.admin_reply_at,
              COALESCE(r.images, '[]'::jsonb) AS images,
              u.first_name,
              LEFT(u.last_name, 1) AS last_initial,
              (r.order_id IS NOT NULL) AS verified_purchase
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

  findByUser: async (userId, productId = null) => {
    if (productId) {
      const { rows } = await pool.query(
        `SELECT r.id, r.rating, r.title, r.body,
                r.admin_reply, r.admin_reply_at,
                COALESCE(r.images, '[]'::jsonb) AS images,
                r.is_approved, r.is_rejected, r.created_at,
                p.name AS product_name, p.id AS product_id, p.image_url
         FROM product_reviews r
         JOIN products p ON r.product_id = p.id
         WHERE r.user_id = $1 AND r.product_id = $2
         ORDER BY r.created_at DESC
         LIMIT 1`,
        [userId, productId]
      );
      return rows[0] || null;
    }
    const { rows } = await pool.query(
      `SELECT r.id, r.rating, r.title, r.body,
              r.admin_reply, r.admin_reply_at,
              COALESCE(r.images, '[]'::jsonb) AS images,
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
      `SELECT id, is_approved, is_rejected
       FROM product_reviews
       WHERE user_id = $1 AND product_id = $2
       LIMIT 1`,
      [userId, productId]
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      const review_status = row.is_approved
        ? 'approved'
        : row.is_rejected
          ? 'rejected'
          : 'pending';
      return {
        can_review: false,
        already_reviewed: true,
        review_status,
        order_id: null,
      };
    }

    const delivered = await pool.query(
      `SELECT o.id
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       WHERE (o.customer_id = $1 OR (o.guest_email IS NOT NULL AND LOWER(o.guest_email) = (SELECT LOWER(email) FROM users WHERE id = $1)))
         AND oi.product_id = $2
         AND o.status = 'delivered'
       ORDER BY o.updated_at DESC
       LIMIT 1`,
      [userId, productId]
    );

    const orderId = delivered.rows[0]?.id || null;
    return {
      can_review: Boolean(orderId),
      already_reviewed: false,
      order_id: orderId,
      verified_purchase: Boolean(orderId),
    };
  },

  // Returns pending products from delivered orders that this user hasn't reviewed yet
  getPendingReviewPrompts: async (userId) => {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (p.id)
              o.id AS order_id,
              o.order_number,
              o.updated_at AS delivered_at,
              p.id AS product_id,
              p.name AS product_name,
              p.image_url AS product_image,
              p.price
       FROM orders o
       JOIN order_items oi ON o.id = oi.order_id
       JOIN products p ON oi.product_id = p.id
       LEFT JOIN product_reviews pr ON pr.user_id = $1 AND pr.product_id = p.id
       WHERE (o.customer_id = $1 OR (o.guest_email IS NOT NULL AND LOWER(o.guest_email) = (SELECT LOWER(email) FROM users WHERE id = $1)))
         AND o.status = 'delivered'
         AND pr.id IS NULL
       ORDER BY p.id, o.updated_at DESC
       LIMIT 5`,
      [userId]
    );
    return rows;
  },

  // Public approved 4★–5★ reviews for homepage testimonials
  getFeaturedReviews: async (limit = 8) => {
    const { rows } = await pool.query(
      `SELECT r.id, r.rating, r.title, r.body, r.created_at,
              r.admin_reply, r.admin_reply_at,
              COALESCE(r.images, '[]'::jsonb) AS images,
              u.first_name,
              LEFT(u.last_name, 1) AS last_initial,
              p.id AS product_id,
              p.name AS product_name,
              p.image_url AS product_image,
              COALESCE(o.shipping_city, 'Accra, Ghana') AS location,
              (r.order_id IS NOT NULL) AS verified_purchase
       FROM product_reviews r
       JOIN users u ON r.user_id = u.id
       JOIN products p ON r.product_id = p.id
       LEFT JOIN orders o ON r.order_id = o.id
       WHERE r.is_approved = TRUE AND r.rating >= 4
       ORDER BY r.rating DESC, r.created_at DESC
       LIMIT $1`,
      [limit]
    );
    return rows;
  },

  create: async ({ product_id, user_id, order_id, rating, title, body, images = [], autoApprove = false }) => {
    const imagesJson = JSON.stringify(Array.isArray(images) ? images : []);
    const { rows } = await pool.query(
      `INSERT INTO product_reviews (product_id, user_id, order_id, rating, title, body, images, is_approved)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       RETURNING id, product_id, is_approved`,
      [product_id, user_id, order_id || null, rating, title || null, body || null, imagesJson, autoApprove]
    );
    if (autoApprove) {
      await ReviewModel.recalculateProductRating(product_id);
    }
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

  reply: async (reviewId, replyText, adminUserId = null) => {
    const clean = typeof replyText === 'string' ? replyText.trim() : '';
    const val = clean || null;
    const { rows } = await pool.query(
      `UPDATE product_reviews
          SET admin_reply = $2::text,
              admin_reply_at = CASE WHEN $2::text IS NOT NULL THEN NOW() ELSE NULL END,
              admin_reply_by = CASE WHEN $2::text IS NOT NULL THEN $3::uuid ELSE NULL END,
              updated_at = NOW()
        WHERE id = $1
        RETURNING id, product_id, admin_reply, admin_reply_at`,
      [reviewId, val, adminUserId]
    );
    return rows[0] || null;
  },

  delete: async (reviewId) => {
    const { rows } = await pool.query(
      `DELETE FROM product_reviews WHERE id = $1 RETURNING id, product_id, rating, title, body`,
      [reviewId]
    );
    if (rows.length) {
      await ReviewModel.recalculateProductRating(rows[0].product_id);
    }
    return rows[0] || null;
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
  findAll: async ({ status = 'all', rating = null, page = 1, limit = 20, search = '' } = {}) => {
    const offset = (page - 1) * limit;

    let statusClause;
    if (status === 'needs_reply')      statusClause = `r.is_approved = TRUE AND (r.admin_reply IS NULL OR TRIM(r.admin_reply) = '')`;
    else if (status === 'replied')     statusClause = `r.admin_reply IS NOT NULL AND TRIM(r.admin_reply) <> ''`;
    else if (status === 'low_rating')  statusClause = `r.is_approved = TRUE AND r.rating <= 3`;
    else if (status === 'with_photos') statusClause = `r.is_approved = TRUE AND jsonb_array_length(COALESCE(r.images, '[]'::jsonb)) > 0`;
    else if (status === 'pending')     statusClause = 'r.is_approved = FALSE AND r.is_rejected = FALSE';
    else if (status === 'approved')    statusClause = 'r.is_approved = TRUE';
    else if (status === 'rejected')    statusClause = 'r.is_rejected = TRUE';
    else statusClause = 'r.is_approved = TRUE';

    const filterParams = [];
    const extraClauses = [];

    if (search) {
      filterParams.push(`%${search}%`);
      const idx = filterParams.length;
      extraClauses.push(
        `(p.name ILIKE $${idx} OR u.email ILIKE $${idx} OR u.first_name ILIKE $${idx} OR u.last_name ILIKE $${idx} OR COALESCE(r.title, '') ILIKE $${idx} OR COALESCE(r.body, '') ILIKE $${idx} OR COALESCE(r.admin_reply, '') ILIKE $${idx})`
      );
    }

    const parsedRating = Number.isInteger(rating) ? rating : parseInt(rating, 10);
    if (parsedRating >= 1 && parsedRating <= 5) {
      filterParams.push(parsedRating);
      extraClauses.push(`r.rating = $${filterParams.length}`);
    }

    const extraWhere = extraClauses.length ? `AND ${extraClauses.join(' AND ')}` : '';
    const listParams = [...filterParams, limit, offset];
    const limitIdx  = listParams.length - 1;
    const offsetIdx = listParams.length;

    const { rows } = await pool.query(
      `SELECT r.id, r.user_id, r.order_id, r.rating, r.title, r.body,
              r.admin_reply, r.admin_reply_at,
              COALESCE(r.images, '[]'::jsonb) AS images,
              r.is_approved, r.is_rejected, r.rejection_reason,
              (r.order_id IS NOT NULL) AS verified_purchase,
              r.helpful_count, r.created_at,
              u.first_name, u.last_name, u.email,
              p.name AS product_name, p.id AS product_id, p.image_url,
              o.order_number
       FROM product_reviews r
       JOIN users u ON r.user_id = u.id
       JOIN products p ON r.product_id = p.id
       LEFT JOIN orders o ON r.order_id = o.id
       WHERE ${statusClause} ${extraWhere}
       ORDER BY r.created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      listParams
    );

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM product_reviews r
       JOIN users u ON r.user_id = u.id
       JOIN products p ON r.product_id = p.id
       WHERE ${statusClause} ${extraWhere}`,
      filterParams
    );

    return { rows, total: countResult.rows[0].total };
  },

  getStatusCounts: async () => {
    const { rows } = await pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE is_approved = TRUE)::int AS total,
        COUNT(*) FILTER (WHERE is_approved = TRUE AND (admin_reply IS NULL OR TRIM(admin_reply) = ''))::int AS needs_reply,
        COUNT(*) FILTER (WHERE is_approved = TRUE AND admin_reply IS NOT NULL AND TRIM(admin_reply) <> '')::int AS replied,
        COUNT(*) FILTER (WHERE is_approved = TRUE AND rating <= 3)::int AS low_rating,
        COUNT(*) FILTER (WHERE is_approved = TRUE AND jsonb_array_length(COALESCE(images, '[]'::jsonb)) > 0)::int AS with_photos,
        COALESCE(ROUND(AVG(rating) FILTER (WHERE is_approved = TRUE)::numeric, 2), 0)::float AS avg_rating,
        COUNT(*) FILTER (WHERE is_approved = FALSE AND is_rejected = FALSE)::int AS pending,
        COUNT(*) FILTER (WHERE is_approved = TRUE)::int AS approved,
        COUNT(*) FILTER (WHERE is_rejected = TRUE)::int AS rejected
       FROM product_reviews`
    );
    return rows[0];
  },
};

module.exports = ReviewModel;

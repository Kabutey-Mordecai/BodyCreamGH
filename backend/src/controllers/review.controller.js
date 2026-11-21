'use strict';

const ReviewModel = require('../models/review.model');

// GET /api/products/:productId/reviews
const getReviews = async (req, res) => {
  try {
    const { productId } = req.params;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 10);
    const sort  = req.query.sort || 'recent';

    const [{ rows: reviews, total }, summary, distribution] = await Promise.all([
      ReviewModel.findByProduct(productId, { approvedOnly: true, page, limit, sort }),
      ReviewModel.getSummary(productId),
      ReviewModel.getDistribution(productId),
    ]);

    res.json({
      reviews,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      summary: {
        avg_rating:   parseFloat(summary.avg_rating  || 0),
        review_count: summary.review_count || 0,
        distribution,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load reviews' });
  }
};

// GET /api/products/:productId/reviews/can-review  (requireAuth)
const canReview = async (req, res) => {
  try {
    const result = await ReviewModel.canUserReview(req.user.id, req.params.productId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to check review eligibility' });
  }
};

// GET /api/reviews/featured
const getFeaturedReviews = async (req, res) => {
  try {
    const limit = Math.min(20, parseInt(req.query.limit) || 8);
    const reviews = await ReviewModel.getFeaturedReviews(limit);
    res.json({ reviews });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load featured reviews' });
  }
};

// GET /api/reviews/pending-prompts  (requireAuth)
const getPendingReviewPrompts = async (req, res) => {
  try {
    const prompts = await ReviewModel.getPendingReviewPrompts(req.user.id);
    res.json({ prompts });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load pending review prompts' });
  }
};

// POST /api/products/:productId/reviews  (requireAuth)
const createReview = async (req, res) => {
  try {
    const { productId } = req.params;
    const { rating, title, body } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    const { already_reviewed, order_id } =
      await ReviewModel.canUserReview(req.user.id, productId);

    if (already_reviewed) {
      return res.status(409).json({ error: 'You have already reviewed this product' });
    }

    const pool = require('../config/database');
    const settingRes = await pool.query("SELECT value FROM site_settings WHERE key = 'reviews_auto_approve'");
    const autoApprove = settingRes.rows[0]?.value === true || settingRes.rows[0]?.value === 'true';

    await ReviewModel.create({
      product_id: productId,
      user_id:    req.user.id,
      order_id,
      rating:     parseInt(rating),
      title,
      body,
      autoApprove,
    });

    res.status(201).json({
      success: true,
      auto_approved: autoApprove,
      message: autoApprove ? 'Review published!' : 'Review submitted for approval'
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'You have already reviewed this product' });
    }
    const logger = require('../utils/logger');
    logger.error('[review] createReview error', { err: err.message });
    res.status(500).json({ error: 'Failed to submit review' });
  }
};

// POST /api/products/:productId/reviews/:reviewId/helpful  (requireAuth)
const markHelpful = async (req, res) => {
  try {
    await ReviewModel.markHelpful(req.params.reviewId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark as helpful' });
  }
};

// GET /api/admin/reviews?status=pending&page=1&limit=20&search=  (requireAdmin)
const getAllReviews = async (req, res) => {
  try {
    const status = req.query.status || 'pending';
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, parseInt(req.query.limit) || 20);
    const search = req.query.search || '';

    const [{ rows: reviews, total }, counts] = await Promise.all([
      ReviewModel.findAll({ status, page, limit, search }),
      ReviewModel.getStatusCounts(),
    ]);

    res.json({
      reviews,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      counts,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load reviews' });
  }
};

// GET /api/admin/reviews/counts  (requireAdmin)
const getReviewCounts = async (req, res) => {
  try {
    const counts = await ReviewModel.getStatusCounts();
    res.json(counts);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load review counts' });
  }
};

// PATCH /api/admin/reviews/:id/approve  (requireAdmin)
const approveReview = async (req, res) => {
  try {
    await ReviewModel.approve(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to approve review' });
  }
};

// PATCH /api/admin/reviews/:id/reject  (requireAdmin)
const rejectReview = async (req, res) => {
  try {
    const { rejection_reason } = req.body;
    await ReviewModel.reject(req.params.id, rejection_reason);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reject review' });
  }
};

// DELETE /api/admin/reviews/:id  (requireAdmin)
const deleteReview = async (req, res) => {
  try {
    await ReviewModel.delete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete review' });
  }
};

module.exports = {
  getReviews, canReview, createReview, markHelpful,
  getFeaturedReviews, getPendingReviewPrompts,
  getAllReviews, getReviewCounts, approveReview, rejectReview, deleteReview,
};

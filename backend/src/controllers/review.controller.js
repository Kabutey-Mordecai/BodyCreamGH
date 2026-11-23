'use strict';

const ReviewModel = require('../models/review.model');
const { logAdminAction } = require('../utils/audit');

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
    const { rating, title, body, images } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    const { already_reviewed, order_id } =
      await ReviewModel.canUserReview(req.user.id, productId);

    if (already_reviewed) {
      return res.status(409).json({ error: 'You have already reviewed this product' });
    }
    if (!order_id) {
      return res.status(403).json({
        error: 'Only customers with a delivered order for this product can post a verified review.',
      });
    }

    // Transparent verified-review policy: every verified buyer review publishes
    // immediately so store admins cannot selectively hide honest negative ratings.
    const autoApprove = true;

    await ReviewModel.create({
      product_id: productId,
      user_id:    req.user.id,
      order_id,
      rating:     parseInt(rating),
      title,
      body,
      images:     Array.isArray(images) ? images.filter(url => typeof url === 'string').slice(0, 5) : [],
      autoApprove,
    });

    res.status(201).json({
      success: true,
      auto_approved: true,
      message: 'Thank you! Your verified review is now live.',
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

// GET /api/admin/reviews?status=all&page=1&limit=20&search=  (requireAdmin)
const getAllReviews = async (req, res) => {
  try {
    const status = req.query.status || 'all';
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

// PATCH /api/admin/reviews/:id/approve  (disabled to prevent selective suppression)
const approveReview = async (req, res) => {
  res.status(403).json({
    error: 'Verified reviews publish automatically to protect customer trust. Use Public Reply instead.',
  });
};

// PATCH /api/admin/reviews/:id/reject  (disabled to prevent hiding honest negative reviews)
const rejectReview = async (req, res) => {
  res.status(403).json({
    error: 'Rejecting verified customer reviews is disabled to prevent rating manipulation. Post a Public Reply or remove only for documented policy violations.',
  });
};

// PATCH /api/admin/reviews/:id/reply  (requireAdmin)
const replyToReview = async (req, res) => {
  try {
    const rawReply = typeof req.body?.reply === 'string' ? req.body.reply.trim() : '';
    if (rawReply.length > 1000) {
      return res.status(400).json({ error: 'Store reply must be 1000 characters or fewer' });
    }
    const updated = await ReviewModel.reply(req.params.id, rawReply, req.user?.id || null);
    if (!updated) return res.status(404).json({ error: 'Review not found' });

    logAdminAction({
      actorId: req.user?.id,
      actorEmail: req.userEmail,
      action: rawReply ? 'review.public_reply' : 'review.reply_cleared',
      resourceType: 'review',
      resourceId: req.params.id,
      details: { reply_preview: rawReply.slice(0, 140) },
      ip: req.ip,
    }).catch(() => {});

    res.json({ ok: true, review: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save public reply' });
  }
};

// DELETE /api/admin/reviews/:id  (requireAdmin — strict audit-logged policy violation removal)
const deleteReview = async (req, res) => {
  try {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason || reason.length < 5) {
      return res.status(400).json({
        error: 'A policy violation reason (min 5 characters) is required to remove a review and is permanently audit-logged.',
      });
    }
    const deleted = await ReviewModel.delete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Review not found' });

    logAdminAction({
      actorId: req.user?.id,
      actorEmail: req.userEmail,
      action: 'review.removed_policy_violation',
      resourceType: 'review',
      resourceId: req.params.id,
      details: {
        reason,
        removed_rating: deleted.rating,
        removed_title: deleted.title,
        removed_body_preview: (deleted.body || '').slice(0, 200),
      },
      ip: req.ip,
    }).catch(() => {});

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove review' });
  }
};

module.exports = {
  getReviews, canReview, createReview, markHelpful,
  getFeaturedReviews, getPendingReviewPrompts,
  getAllReviews, getReviewCounts, approveReview, rejectReview, replyToReview, deleteReview,
};

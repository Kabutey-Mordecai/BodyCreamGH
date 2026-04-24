const ReviewModel = require('../models/review.model');

const getReviews = async (req, res) => {
  try {
    const [reviews, stats] = await Promise.all([
      ReviewModel.findByProduct(req.params.productId),
      ReviewModel.getStats(req.params.productId),
    ]);
    res.json({ reviews, stats });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load reviews' });
  }
};

const createReview = async (req, res) => {
  try {
    const { productId } = req.params;
    const { rating, title, body } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    const purchased = await ReviewModel.hasPurchased(req.user.id, productId);
    if (!purchased) {
      return res.status(403).json({ error: 'You can only review products you have purchased' });
    }

    const existing = await ReviewModel.findByUser(req.user.id, productId);
    if (existing) {
      return res.status(409).json({ error: 'You have already reviewed this product' });
    }

    const id = await ReviewModel.create(productId, req.user.id, { rating, title, body });
    res.status(201).json({ id });
  } catch (err) {
    console.error('Create review error:', err);
    res.status(500).json({ error: 'Failed to submit review' });
  }
};

const deleteReview = async (req, res) => {
  try {
    await ReviewModel.remove(req.params.reviewId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete review' });
  }
};

const getAllReviews = async (req, res) => {
  try {
    const reviews = await ReviewModel.findAll({
      limit: parseInt(req.query.limit) || 50,
      offset: parseInt(req.query.offset) || 0,
    });
    res.json(reviews);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load reviews' });
  }
};

module.exports = { getReviews, createReview, deleteReview, getAllReviews };

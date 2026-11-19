'use strict';

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const {
  getFeaturedReviews,
  getPendingReviewPrompts,
} = require('../controllers/review.controller');

// Public: Get featured reviews from verified buyers for the homepage & storefront
router.get('/featured', getFeaturedReviews);

// Authenticated: Get pending products from delivered orders awaiting review
router.get('/pending-prompts', verifyToken, getPendingReviewPrompts);

module.exports = router;

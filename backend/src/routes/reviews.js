'use strict';

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { makeRateLimiter } = require('../middleware/rateLimit');
const { uploadSingleMediaMiddleware } = require('../middleware/uploadFilter');
const { uploadGenericMedia } = require('../controllers/admin.controller');
const {
  getFeaturedReviews,
  getPendingReviewPrompts,
} = require('../controllers/review.controller');

const reviewUploadLimiter = makeRateLimiter(
  15 * 60 * 1000,
  20,
  'Too many review photo uploads. Please try again later.',
  {
    keyGenerator: (req, ip) => (req.user?.id ? `rev:upload:user:${req.user.id}` : `rev:upload:ip:${ip}`),
  }
);

// Public: Get featured reviews from verified buyers for the homepage & storefront
router.get('/featured', getFeaturedReviews);

// Authenticated: Get pending products from delivered orders awaiting review
router.get('/pending-prompts', verifyToken, getPendingReviewPrompts);

// Authenticated: Upload a customer review photo (swatch / result)
router.post('/upload', verifyToken, reviewUploadLimiter, uploadSingleMediaMiddleware, uploadGenericMedia);

module.exports = router;

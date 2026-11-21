const express = require('express');
const { verifyToken, optionalToken, requireAdmin } = require('../middleware/auth');
const { makeRateLimiter } = require('../middleware/rateLimit');
const { validateProduct } = require('../middleware/validation');
const { getProducts, suggestProducts, getProductById, getRelatedProducts, createProduct, updateProduct, deleteProduct, getAdminProducts, toggleProductVisibility } = require('../controllers/product.controller');
const { getReviews, canReview, createReview, markHelpful, deleteReview } = require('../controllers/review.controller');
const {
  getVariants, createVariant, updateVariant, deleteVariant,
  createOptionType, deleteOptionType, createOptionValue, deleteOptionValue,
} = require('../controllers/variant.controller');

const router = express.Router();
const reviewWriteLimiter   = makeRateLimiter(60 * 60 * 1000, 10, 'Too many review submissions. Please try again later.');
const reviewHelpfulLimiter = makeRateLimiter(15 * 60 * 1000, 30, 'Too many requests. Please try again later.');

router.get('/admin', verifyToken, requireAdmin, getAdminProducts);
router.get('/suggest', suggestProducts);
router.get('/', getProducts);
router.get('/:id/related', getRelatedProducts);
router.get('/:id', getProductById);
router.post('/', verifyToken, requireAdmin, validateProduct, createProduct);
router.put('/:id', verifyToken, requireAdmin, validateProduct, updateProduct);
router.delete('/:id', verifyToken, requireAdmin, deleteProduct);
router.patch('/:id/toggle-visibility', verifyToken, requireAdmin, toggleProductVisibility);

// Reviews — static route before dynamic to prevent 'can-review' matching :reviewId
router.get('/:productId/reviews/can-review',            verifyToken, canReview);
router.get('/:productId/reviews',                       getReviews);
router.post('/:productId/reviews',                      reviewWriteLimiter,   verifyToken, createReview);
router.post('/:productId/reviews/:reviewId/helpful',    reviewHelpfulLimiter, verifyToken, markHelpful);
router.delete('/:productId/reviews/:reviewId',          verifyToken, requireAdmin, deleteReview);

// Variants — public GET (optionalToken lets admin get inactive variants too)
router.get('/:id/variants',                                     optionalToken, getVariants);
router.post('/:id/variants',                  verifyToken, requireAdmin, createVariant);
router.put('/:id/variants/:variantId',        verifyToken, requireAdmin, updateVariant);
router.delete('/:id/variants/:variantId',     verifyToken, requireAdmin, deleteVariant);

// Option types
router.post('/:id/option-types',              verifyToken, requireAdmin, createOptionType);
router.delete('/:id/option-types/:typeId',    verifyToken, requireAdmin, deleteOptionType);

// Option values
router.post('/:id/option-types/:typeId/values',  verifyToken, requireAdmin, createOptionValue);
router.delete('/:id/option-values/:valueId',     verifyToken, requireAdmin, deleteOptionValue);

module.exports = router;

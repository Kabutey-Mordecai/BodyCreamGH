const express = require('express');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { validateProduct } = require('../middleware/validation');
const { getProducts, getProductById, createProduct, updateProduct, deleteProduct } = require('../controllers/product.controller');
const { getReviews, createReview, deleteReview } = require('../controllers/review.controller');

const router = express.Router();

router.get('/', getProducts);
router.get('/:id', getProductById);
router.post('/', verifyToken, requireAdmin, validateProduct, createProduct);
router.put('/:id', verifyToken, requireAdmin, validateProduct, updateProduct);
router.delete('/:id', verifyToken, requireAdmin, deleteProduct);

// Reviews
router.get('/:productId/reviews', getReviews);
router.post('/:productId/reviews', verifyToken, createReview);
router.delete('/:productId/reviews/:reviewId', verifyToken, requireAdmin, deleteReview);

module.exports = router;

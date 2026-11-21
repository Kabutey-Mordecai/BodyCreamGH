const express = require('express');
const { verifyToken, requireAdmin, optionalToken } = require('../middleware/auth');
const { validateCoupon, getAllCoupons, createCoupon, updateCoupon, deactivateCoupon, deleteCoupon } = require('../controllers/coupon.controller');

const router = express.Router();

// Public — validate a code before checkout (optional JWT so first-order welcome coupons know the customer)
router.post('/validate', optionalToken, validateCoupon);

// Admin only
router.get('/',                  verifyToken, requireAdmin, getAllCoupons);
router.post('/',                 verifyToken, requireAdmin, createCoupon);
router.put('/:id',               verifyToken, requireAdmin, updateCoupon);
router.patch('/:id/deactivate',  verifyToken, requireAdmin, deactivateCoupon);
router.delete('/:id',            verifyToken, requireAdmin, deleteCoupon);

module.exports = router;

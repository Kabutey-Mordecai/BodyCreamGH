const express = require('express');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { validateCoupon, getAllCoupons, createCoupon, deactivateCoupon, deleteCoupon } = require('../controllers/coupon.controller');

const router = express.Router();

// Public — validate a code before checkout (no JWT required; order total is sent server-side too)
router.post('/validate', validateCoupon);

// Admin only
router.get('/',                  verifyToken, requireAdmin, getAllCoupons);
router.post('/',                 verifyToken, requireAdmin, createCoupon);
router.patch('/:id/deactivate',  verifyToken, requireAdmin, deactivateCoupon);
router.delete('/:id',            verifyToken, requireAdmin, deleteCoupon);

module.exports = router;

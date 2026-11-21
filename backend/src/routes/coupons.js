const express = require('express');
const { verifyToken, requireAdmin, requireRoles, optionalToken } = require('../middleware/auth');
const { validateCoupon, getAllCoupons, createCoupon, updateCoupon, deactivateCoupon, deleteCoupon } = require('../controllers/coupon.controller');

const router = express.Router();
const requireMarketingOrAdmin = requireRoles('admin', 'super_admin', 'marketing');

// Public — validate a code before checkout (optional JWT so first-order welcome coupons know the customer)
router.post('/validate', optionalToken, validateCoupon);

// Admin / Marketing
router.get('/',                  verifyToken, requireAdmin, requireMarketingOrAdmin, getAllCoupons);
router.post('/',                 verifyToken, requireAdmin, requireMarketingOrAdmin, createCoupon);
router.put('/:id',               verifyToken, requireAdmin, requireMarketingOrAdmin, updateCoupon);
router.patch('/:id/deactivate',  verifyToken, requireAdmin, requireMarketingOrAdmin, deactivateCoupon);
router.delete('/:id',            verifyToken, requireAdmin, requireMarketingOrAdmin, deleteCoupon);

module.exports = router;

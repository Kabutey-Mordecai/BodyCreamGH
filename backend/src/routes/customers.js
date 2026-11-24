const express = require('express');
const { verifyToken, requireAdmin, requireRoles } = require('../middleware/auth');
const requireSuperOrAdmin = requireRoles('admin', 'super_admin');
const { getProfile, updateProfile, changePassword, getCustomerById, getCustomerOrders } = require('../controllers/customer.controller');

const router = express.Router();

router.get('/profile', verifyToken, getProfile);
router.put('/profile', verifyToken, updateProfile);
router.put('/password', verifyToken, changePassword);

// Admin — drill into a specific customer
router.get('/:id', verifyToken, requireAdmin, requireSuperOrAdmin, getCustomerById);
router.get('/:id/orders', verifyToken, requireAdmin, requireSuperOrAdmin, getCustomerOrders);

module.exports = router;

const express = require('express');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { getProfile, updateProfile, changePassword, getCustomerById, getCustomerOrders } = require('../controllers/customer.controller');

const router = express.Router();

router.get('/profile', verifyToken, getProfile);
router.put('/profile', verifyToken, updateProfile);
router.put('/password', verifyToken, changePassword);

// Admin — drill into a specific customer
router.get('/:id', verifyToken, requireAdmin, getCustomerById);
router.get('/:id/orders', verifyToken, requireAdmin, getCustomerOrders);

module.exports = router;

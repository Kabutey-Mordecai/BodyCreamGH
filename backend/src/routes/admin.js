const express = require('express');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { getDashboard, getAnalytics, getTopProducts, getInventoryOverview, getAllCustomers } = require('../controllers/admin.controller');

const router = express.Router();

router.get('/dashboard', verifyToken, requireAdmin, getDashboard);
router.get('/analytics', verifyToken, requireAdmin, getAnalytics);
router.get('/top-products', verifyToken, requireAdmin, getTopProducts);
router.get('/inventory', verifyToken, requireAdmin, getInventoryOverview);
router.get('/customers', verifyToken, requireAdmin, getAllCustomers);

module.exports = router;

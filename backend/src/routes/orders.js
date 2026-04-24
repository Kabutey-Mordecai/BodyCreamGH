const express = require('express');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { createOrder, getOrders, getOrderById, getAllOrders, updateOrderStatus } = require('../controllers/order.controller');

const router = express.Router();

router.post('/', verifyToken, createOrder);
router.get('/', verifyToken, getOrders);
router.get('/admin/all', verifyToken, requireAdmin, getAllOrders);
router.get('/:orderId', verifyToken, getOrderById);
router.patch('/:orderId/status', verifyToken, requireAdmin, updateOrderStatus);

module.exports = router;

const express = require('express');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { validateCreateOrder, validateCreateGuest, validateOrderStatus } = require('../middleware/validation');
const { createOrder, createGuestOrder, getOrders, getOrderById, getAllOrders, updateOrderStatus, getOrderStatusLog } = require('../controllers/order.controller');

const router = express.Router();

router.post('/guest', validateCreateGuest, createGuestOrder);  // no auth — guest checkout
router.post('/', verifyToken, validateCreateOrder, createOrder);
router.get('/', verifyToken, getOrders);
router.get('/admin/all', verifyToken, requireAdmin, getAllOrders);
router.get('/:orderId', verifyToken, getOrderById);
router.patch('/:orderId/status', verifyToken, requireAdmin, validateOrderStatus, updateOrderStatus);
router.get('/:orderId/log',      verifyToken, getOrderStatusLog);

module.exports = router;

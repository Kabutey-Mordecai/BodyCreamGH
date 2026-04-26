const express = require('express');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { validateCreateOrder, validateCreateGuest, validateOrderStatus, validateCancelOrder, validateRefundOrder } = require('../middleware/validation');
const { createOrder, createGuestOrder, getOrders, getOrderById, getAllOrders, updateOrderStatus, cancelOrder, refundOrder, getOrderStatusLog, getReviewStatus } = require('../controllers/order.controller');

const router = express.Router();

router.post('/guest', validateCreateGuest, createGuestOrder);  // no auth — guest checkout
router.post('/', verifyToken, validateCreateOrder, createOrder);
router.get('/', verifyToken, getOrders);
router.get('/admin/all', verifyToken, requireAdmin, getAllOrders);
router.get('/:orderId', verifyToken, getOrderById);
router.post('/:orderId/cancel', verifyToken, requireAdmin, validateCancelOrder, cancelOrder);
router.post('/:orderId/refund', verifyToken, requireAdmin, validateRefundOrder, refundOrder);
router.patch('/:orderId/status', verifyToken, requireAdmin, validateOrderStatus, updateOrderStatus);
router.get('/:orderId/log',            verifyToken, getOrderStatusLog);
router.get('/:orderId/review-status',  verifyToken, getReviewStatus);

module.exports = router;

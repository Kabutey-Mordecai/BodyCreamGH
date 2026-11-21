const express = require('express');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { makeRateLimiter } = require('../middleware/rateLimit');
const {
  validateCreateOrder, validateCreateGuest, validateOrderStatus,
  validateCancelOrder, validateRefundOrder,
  validateRequestCancel, validateRequestReturn,
} = require('../middleware/validation');
const {
  createOrder, createGuestOrder, getOrders, getOrderById, getAllOrders,
  getRequestCounts, getRequests, exportOrders,
  updateOrderStatus, cancelOrder, refundOrder, markOrderPaid, refundDuplicatePayment, getOrderStatusLog, getReviewStatus,
  requestCancel, requestReturn,
  approveCancelRequest, rejectCancelRequest,
  approveReturnRequest, rejectReturnRequest,
  trackOrder,
} = require('../controllers/order.controller');
const {
  getOrderReturns,
  createReturnRequest,
  cancelReturnRequest,
  getAdminReturns,
  approveReturnRequestById,
  rejectReturnRequestById,
} = require('../controllers/return.controller');

const router = express.Router();
const trackLimiter = makeRateLimiter(15 * 60 * 1000, 20, 'Too many tracking requests. Please try again later.');
const returnCreateLimiter = makeRateLimiter(15 * 60 * 1000, 10, 'Too many return requests. Please try again later.', {
  keyGenerator: (req, ip) => `ret:create:${req.user?.id || ip}`,
});
const returnCancelLimiter = makeRateLimiter(15 * 60 * 1000, 20, 'Too many return cancellation requests. Please try again later.', {
  keyGenerator: (req, ip) => `ret:cancel:${req.user?.id || ip}`,
});
const trackOrderNumberLimiter = makeRateLimiter(
  15 * 60 * 1000,
  10,
  'Too many tracking requests for this order. Please try again later.',
  {
    keyGenerator: (req, ip) => {
      const raw = typeof req.body?.order_number === 'string'
        ? req.body.order_number.trim().replace(/^#+/, '').replace(/\s+/g, '').toLowerCase()
        : '';
      return raw ? `track:ord:${raw}` : `track:ip:${ip}`;
    },
  }
);

// Public tracking — must be before /:orderId to avoid route conflict
router.post('/track', trackLimiter, trackOrderNumberLimiter, trackOrder);

router.post('/guest', validateCreateGuest, createGuestOrder);  // no auth — guest checkout
router.post('/', verifyToken, validateCreateOrder, createOrder);
router.get('/', verifyToken, getOrders);
router.get('/admin/all',              verifyToken, requireAdmin, getAllOrders);
router.get('/admin/requests/counts', verifyToken, requireAdmin, getRequestCounts);
router.get('/admin/requests',        verifyToken, requireAdmin, getRequests);
router.get('/admin/export',          verifyToken, requireAdmin, exportOrders);
// Item-level partial returns (admin) — MUST be mounted before /:orderId
router.get('/admin/returns',                   verifyToken, requireAdmin, getAdminReturns);
router.post('/admin/returns/:returnId/approve', verifyToken, requireAdmin, approveReturnRequestById);
router.post('/admin/returns/:returnId/reject',  verifyToken, requireAdmin, rejectReturnRequestById);
router.get('/:orderId', verifyToken, getOrderById);

// Item-level partial returns (logged-in customer owner or admin for GET)
router.get('/:orderId/returns',                    verifyToken, getOrderReturns);
router.post('/:orderId/returns',                   verifyToken, returnCreateLimiter, createReturnRequest);
router.post('/:orderId/returns/:returnId/cancel',  verifyToken, returnCancelLimiter, cancelReturnRequest);

// Admin-only fulfilment actions
router.post('/:orderId/cancel',    verifyToken, requireAdmin, validateCancelOrder,  cancelOrder);
router.post('/:orderId/refund',    verifyToken, requireAdmin, validateRefundOrder,  refundOrder);
router.post('/:orderId/payments/:paymentId/refund-duplicate', verifyToken, requireAdmin, refundDuplicatePayment);
router.post('/:orderId/mark-paid', verifyToken, requireAdmin, markOrderPaid);
router.patch('/:orderId/status',   verifyToken, requireAdmin, validateOrderStatus,  updateOrderStatus);

// Customer request routes (authenticated, no requireAdmin)
router.post('/:orderId/request-cancel', verifyToken, validateRequestCancel, requestCancel);
router.post('/:orderId/request-return', verifyToken, validateRequestReturn, requestReturn);

// Admin approve/reject request routes
router.post('/:orderId/approve-cancel', verifyToken, requireAdmin, approveCancelRequest);
router.post('/:orderId/reject-cancel',  verifyToken, requireAdmin, rejectCancelRequest);
router.post('/:orderId/approve-return', verifyToken, requireAdmin, approveReturnRequest);
router.post('/:orderId/reject-return',  verifyToken, requireAdmin, rejectReturnRequest);

router.get('/:orderId/log',           verifyToken, getOrderStatusLog);
router.get('/:orderId/review-status', verifyToken, getReviewStatus);

module.exports = router;

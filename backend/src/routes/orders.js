const express = require('express');
const { verifyToken, optionalToken, requireAdmin, requireRoles } = require('../middleware/auth');
const requireSuperOrAdmin = requireRoles('admin', 'super_admin');
const requireFulfillmentOrAdmin = requireRoles('admin', 'super_admin', 'fulfillment');
const requireSupportOrAdmin = requireRoles('admin', 'super_admin', 'support');
const requireOrderOps = requireRoles('admin', 'super_admin', 'fulfillment', 'support');
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
  upsertCheckoutSession, getAbandonedCheckouts, sendAbandonedCheckoutReminder,
  showCheckoutSessionOptOut, confirmCheckoutSessionOptOut, deleteCheckoutSession,
} = require('../controllers/order.controller');
const {
  getOrderReturns,
  createReturnRequest,
  adminCreateReturnRequest,
  cancelReturnRequest,
  getAdminReturns,
  approveReturnRequestById,
  rejectReturnRequestById,
} = require('../controllers/return.controller');

const router = express.Router();
const trackLimiter = makeRateLimiter(15 * 60 * 1000, 20, 'Too many tracking requests. Please try again later.');
const checkoutSessionLimiter = makeRateLimiter(15 * 60 * 1000, 15, 'Too many checkout session updates. Please try again later.');
const returnCreateLimiter = makeRateLimiter(15 * 60 * 1000, 10, 'Too many return requests. Please try again later.', {
  keyGenerator: (req, ip) => `ret:create:${req.user?.id || ip}`,
});
const returnCancelLimiter = makeRateLimiter(15 * 60 * 1000, 20, 'Too many return cancellation requests. Please try again later.', {
  keyGenerator: (req, ip) => `ret:cancel:${req.user?.id || ip}`,
});
const requirePartialReturnsEnabled = (_req, res, next) => {
  if (process.env.PARTIAL_RETURNS_ENABLED !== 'true') {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
};
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

// Public tracking & abandoned checkout lead capture — must be before /:orderId
router.post('/track', trackLimiter, trackOrderNumberLimiter, trackOrder);
router.post('/checkout-session', checkoutSessionLimiter, optionalToken, upsertCheckoutSession);
router.delete('/checkout-session', trackLimiter, optionalToken, deleteCheckoutSession);
router.get('/checkout-session/opt-out', trackLimiter, showCheckoutSessionOptOut);
router.post('/checkout-session/opt-out', trackLimiter, confirmCheckoutSessionOptOut);

router.post('/guest', validateCreateGuest, createGuestOrder);  // no auth — guest checkout
router.post('/', verifyToken, validateCreateOrder, createOrder);
router.get('/', verifyToken, getOrders);
router.get('/admin/all',              verifyToken, requireAdmin, requireOrderOps, getAllOrders);
router.get('/admin/abandoned',        verifyToken, requireAdmin, requireSupportOrAdmin, getAbandonedCheckouts);
router.post('/admin/abandoned/:sessionId/remind', verifyToken, requireAdmin, requireSupportOrAdmin, sendAbandonedCheckoutReminder);
router.get('/admin/requests/counts', verifyToken, requireAdmin, requireOrderOps, getRequestCounts);
router.get('/admin/requests',        verifyToken, requireAdmin, requireOrderOps, getRequests);
router.get('/admin/export',          verifyToken, requireAdmin, requireSuperOrAdmin, exportOrders);
// Item-level partial returns (admin) — MUST be mounted before /:orderId
router.get('/admin/returns',                   requirePartialReturnsEnabled, verifyToken, requireAdmin, requireOrderOps, getAdminReturns);
router.post('/admin/:orderId/returns',         requirePartialReturnsEnabled, verifyToken, requireAdmin, requireSupportOrAdmin, adminCreateReturnRequest);
router.post('/admin/returns/:returnId/approve', requirePartialReturnsEnabled, verifyToken, requireAdmin, requireSuperOrAdmin, approveReturnRequestById);
router.post('/admin/returns/:returnId/reject',  requirePartialReturnsEnabled, verifyToken, requireAdmin, requireSupportOrAdmin, rejectReturnRequestById);
router.get('/:orderId', verifyToken, getOrderById);

// Item-level partial returns (logged-in customer owner or admin for GET)
router.get('/:orderId/returns',                    requirePartialReturnsEnabled, verifyToken, getOrderReturns);
router.post('/:orderId/returns',                   requirePartialReturnsEnabled, verifyToken, returnCreateLimiter, createReturnRequest);
router.post('/:orderId/returns/:returnId/cancel',  requirePartialReturnsEnabled, verifyToken, returnCancelLimiter, cancelReturnRequest);

// Admin-only fulfilment & refund actions
router.post('/:orderId/cancel',    verifyToken, requireAdmin, requireFulfillmentOrAdmin, validateCancelOrder,  cancelOrder);
router.post('/:orderId/refund',    verifyToken, requireAdmin, requireSuperOrAdmin, validateRefundOrder,  refundOrder);
router.post('/:orderId/payments/:paymentId/refund-duplicate', verifyToken, requireAdmin, requireSuperOrAdmin, refundDuplicatePayment);
router.post('/:orderId/mark-paid', verifyToken, requireAdmin, requireFulfillmentOrAdmin, markOrderPaid);
router.patch('/:orderId/status',   verifyToken, requireAdmin, requireFulfillmentOrAdmin, validateOrderStatus,  updateOrderStatus);

// Customer request routes (authenticated, no requireAdmin)
router.post('/:orderId/request-cancel', verifyToken, validateRequestCancel, requestCancel);
router.post('/:orderId/request-return', verifyToken, validateRequestReturn, requestReturn);

// Admin approve/reject request routes
router.post('/:orderId/approve-cancel', verifyToken, requireAdmin, requireSupportOrAdmin, approveCancelRequest);
router.post('/:orderId/reject-cancel',  verifyToken, requireAdmin, requireSupportOrAdmin, rejectCancelRequest);
router.post('/:orderId/approve-return', verifyToken, requireAdmin, requireSuperOrAdmin, approveReturnRequest);
router.post('/:orderId/reject-return',  verifyToken, requireAdmin, requireSupportOrAdmin, rejectReturnRequest);

router.get('/:orderId/log',           verifyToken, getOrderStatusLog);
router.get('/:orderId/review-status', verifyToken, getReviewStatus);

module.exports = router;

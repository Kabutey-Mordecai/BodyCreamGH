'use strict';

const express = require('express');
const { verifyToken, optionalToken } = require('../middleware/auth');
const { makeRateLimiter } = require('../middleware/rateLimit');
const {
  initializePayment,
  initializeGuestPayment,
  chargeMobileMoney,
  submitMobileMoneyOtp,
  verifyPayment,
} = require('../controllers/payment.controller');

const router = express.Router();

const initLimiter = makeRateLimiter(60 * 1000, 60, 'Too many payment requests', {
  keyGenerator: (req, ip) => (req.user?.id ? `pay:init:user:${req.user.id}` : `pay:init:ip:${ip}`),
});
const verifyIpLimiter = makeRateLimiter(60 * 1000, 120, 'Too many verification attempts');
const verifyRefLimiter = makeRateLimiter(60 * 1000, 20, 'Too many verification attempts for this reference', {
  keyGenerator: (req, ip) => `${ip}:${String(req.body?.reference || '').slice(0, 100)}`,
});

// Feature-flag guard for parked direct Mobile Money endpoints (default OFF).
const requireDirectMomoEnabled = (_req, res, next) => {
  if (process.env.ENABLE_DIRECT_MOMO !== 'true') {
    return res.status(404).json({ error: 'Not found' });
  }
  return next();
};

// Webhook (/api/payments/webhook) is mounted directly in server.js BEFORE rate limiters.
router.post('/guest/initialize', initLimiter, initializeGuestPayment);  // no auth — guest checkout
router.post('/initialize', verifyToken, initLimiter, initializePayment);
router.post('/charge-momo', requireDirectMomoEnabled, initLimiter, optionalToken, chargeMobileMoney);
router.post('/submit-otp', requireDirectMomoEnabled, initLimiter, optionalToken, submitMobileMoneyOtp);
router.post('/verify', verifyIpLimiter, verifyRefLimiter, optionalToken, verifyPayment);

module.exports = router;

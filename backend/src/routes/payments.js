'use strict';

const express = require('express');
const { verifyToken, optionalToken } = require('../middleware/auth');
const { makeRateLimiter } = require('../middleware/rateLimit');
const { initializePayment, initializeGuestPayment, verifyPayment } = require('../controllers/payment.controller');

const router = express.Router();

const initLimiter = makeRateLimiter(60 * 1000, 30, 'Too many payment requests');
const verifyIpLimiter = makeRateLimiter(60 * 1000, 120, 'Too many verification attempts');
const verifyRefLimiter = makeRateLimiter(60 * 1000, 20, 'Too many verification attempts for this reference', {
  keyGenerator: (req, ip) => `${ip}:${String(req.body?.reference || '').slice(0, 100)}`,
});

// Webhook (/api/payments/webhook) is mounted directly in server.js BEFORE rate limiters.
router.post('/guest/initialize', initLimiter, initializeGuestPayment);  // no auth — guest checkout
router.post('/initialize', initLimiter, verifyToken, initializePayment);
router.post('/verify', verifyIpLimiter, verifyRefLimiter, optionalToken, verifyPayment);

module.exports = router;

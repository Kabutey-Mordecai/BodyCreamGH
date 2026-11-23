'use strict';

const express = require('express');
const { subscribe, unsubscribe, getSubscriptionStatus } = require('../controllers/newsletter.controller');
const { optionalToken } = require('../middleware/auth');
const { makeRateLimiter } = require('../middleware/rateLimit');

const router = express.Router();

// Rate-limit subscribes to prevent abuse: 5 per email/IP per 10 minutes
router.post('/subscribe', makeRateLimiter(10 * 60 * 1000, 5, 'Too many subscription attempts', {
  keyGenerator: (req, ip) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    return email ? `nl:email:${email}` : `nl:ip:${ip}`;
  },
}), subscribe);
router.get('/status', optionalToken, getSubscriptionStatus);
router.get('/unsubscribe', unsubscribe);

module.exports = router;

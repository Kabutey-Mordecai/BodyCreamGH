'use strict';

const express = require('express');
const { subscribe, unsubscribe, getSubscriptionStatus } = require('../controllers/newsletter.controller');
const { optionalToken } = require('../middleware/auth');
const { makeRateLimiter } = require('../middleware/rateLimit');

const router = express.Router();

// Rate-limit subscribes to prevent abuse: 5 per IP per 10 minutes
router.post('/subscribe', makeRateLimiter(10 * 60 * 1000, 5, 'Too many subscription attempts'), subscribe);
router.get('/status', optionalToken, getSubscriptionStatus);
router.get('/unsubscribe', unsubscribe);

module.exports = router;

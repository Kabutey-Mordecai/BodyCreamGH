'use strict';

const express = require('express');
const { makeRateLimiter } = require('../middleware/rateLimit');
const { recordVisit } = require('../controllers/traffic.controller');

const router = express.Router();
const visitLimiter = makeRateLimiter(60 * 1000, 120, 'Too many requests.');

router.post('/visit', visitLimiter, recordVisit);

module.exports = router;

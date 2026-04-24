const express = require('express');
const { verifyToken } = require('../middleware/auth');
const { initializePayment, verifyPayment, handleWebhook } = require('../controllers/payment.controller');

const router = express.Router();

router.post('/initialize', verifyToken, initializePayment);
router.post('/verify', verifyToken, verifyPayment);
router.post('/webhook', handleWebhook);

module.exports = router;

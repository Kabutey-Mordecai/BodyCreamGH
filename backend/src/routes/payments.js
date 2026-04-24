const express = require('express');
const { verifyToken } = require('../middleware/auth');
const { initializePayment, initializeGuestPayment, verifyPayment, handleWebhook } = require('../controllers/payment.controller');

const router = express.Router();

router.post('/guest/initialize', initializeGuestPayment);  // no auth — guest checkout
router.post('/initialize', verifyToken, initializePayment);
router.post('/verify', verifyPayment);  // reference is the credential; no JWT needed
router.post('/webhook', handleWebhook);

module.exports = router;

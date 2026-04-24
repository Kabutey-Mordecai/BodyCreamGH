const express = require('express');
const { verifyToken } = require('../middleware/auth');
const { getProfile, updateProfile, changePassword } = require('../controllers/customer.controller');

const router = express.Router();

router.get('/profile', verifyToken, getProfile);
router.put('/profile', verifyToken, updateProfile);
router.put('/password', verifyToken, changePassword);

module.exports = router;

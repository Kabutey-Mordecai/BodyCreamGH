const express = require('express');
const { verifyToken } = require('../middleware/auth');
const { validateRegister } = require('../middleware/validation');
const {
  register,
  login,
  getMe,
  logout,
  forgotPassword,
  verifyResetToken,
  resetPassword,
} = require('../controllers/auth.controller');

const router = express.Router();

router.post('/register',             validateRegister, register);
router.post('/login',                login);
router.get ('/me',                   verifyToken, getMe);
router.post('/logout',               verifyToken, logout);
router.post('/forgot-password',      forgotPassword);
router.get ('/verify-reset-token/:token', verifyResetToken);
router.post('/reset-password',       resetPassword);

module.exports = router;

const express = require('express');
const { verifyToken } = require('../middleware/auth');
const { validateRegister, validateLogin } = require('../middleware/validation');
const { makeRateLimiter } = require('../middleware/rateLimit');

// Rate limits — keyed per IP
const loginLimiter          = makeRateLimiter(15 * 60 * 1000, 10,  'Too many login attempts. Please try again in 15 minutes.');
const registerLimiter       = makeRateLimiter(60 * 60 * 1000, 5,   'Too many registrations from this address. Please try again later.');
const forgotPasswordLimiter = makeRateLimiter(60 * 60 * 1000, 5,   'Too many password reset requests. Please try again later.');
const {
  register,
  login,
  refresh,
  getMe,
  logout,
  forgotPassword,
  verifyResetToken,
  resetPassword,
} = require('../controllers/auth.controller');

const router = express.Router();

router.post('/register',             registerLimiter,       validateRegister, register);
router.post('/login',                loginLimiter,          validateLogin,    login);
router.post('/refresh',              refresh);  // exchange refresh token for new access token
router.get ('/me',                   verifyToken, getMe);
router.post('/logout',               verifyToken, logout);
router.post('/forgot-password',      forgotPasswordLimiter, forgotPassword);
router.get ('/verify-reset-token/:token', verifyResetToken);
router.post('/reset-password',       resetPassword);

module.exports = router;

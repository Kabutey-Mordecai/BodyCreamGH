'use strict';

const express = require('express');
const { verifyToken }                 = require('../middleware/auth');
const { validateRegister, validateLogin } = require('../middleware/validation');
const { makeRateLimiter }             = require('../middleware/rateLimit');

// Rate limits — keyed per IP
const loginLimiter          = makeRateLimiter(15 * 60 * 1000, 10, 'Too many login attempts. Please try again in 15 minutes.');
const registerLimiter       = makeRateLimiter(60 * 60 * 1000, 5,  'Too many registrations from this address. Please try again later.');
const forgotPasswordLimiter = makeRateLimiter(60 * 60 * 1000, 5,  'Too many password reset requests. Please try again later.');

// Refresh tokens are rotated on every use; an attacker with a valid token needs
// only one request. This limiter primarily blocks token-stuffing attempts.
const refreshLimiter = makeRateLimiter(15 * 60 * 1000, 20, 'Too many token refresh attempts. Please try again later.');

// OTP verification: 10 attempts per 15 minutes per IP.
const otpLimiter = makeRateLimiter(15 * 60 * 1000, 10, 'Too many verification attempts. Please try again later.');

// Reset-password and verify-token share the same budget as forgot-password:
// at most 5 reset emails can be requested per hour, so 10 submissions is plenty.
const resetPasswordLimiter   = makeRateLimiter(60 * 60 * 1000, 10, 'Too many password reset attempts. Please try again later.');
const verifyResetTokenLimiter = makeRateLimiter(15 * 60 * 1000, 20, 'Too many token verification requests. Please try again later.');
const logoutLimiter           = makeRateLimiter(15 * 60 * 1000, 30, 'Too many logout requests. Please try again later.');

const {
  register,
  login,
  verifyOtp,
  refresh,
  getMe,
  logout,
  forgotPassword,
  verifyResetToken,
  resetPassword,
} = require('../controllers/auth.controller');

const router = express.Router();

router.post('/register',                  registerLimiter,        validateRegister, register);
router.post('/login',                     loginLimiter,           validateLogin,    login);
router.post('/verify-otp',                otpLimiter,             verifyOtp);
router.post('/refresh',                   refreshLimiter,         refresh);
router.get ('/me',                        verifyToken,            getMe);
router.post('/logout',                    logoutLimiter,          logout);
router.post('/forgot-password',           forgotPasswordLimiter,  forgotPassword);
router.get ('/verify-reset-token/:token', verifyResetTokenLimiter, verifyResetToken);
router.post('/reset-password',            resetPasswordLimiter,   resetPassword);

module.exports = router;

'use strict';

const express = require('express');
const { verifyToken }                 = require('../middleware/auth');
const { validateRegister, validateLogin } = require('../middleware/validation');
const { makeRateLimiter }             = require('../middleware/rateLimit');

const LOGIN_IP_MAX    = Math.max(1, parseInt(process.env.LOGIN_IP_MAX, 10) || 300);
const LOGIN_ACCT_MAX  = Math.max(1, parseInt(process.env.LOGIN_ACCT_MAX, 10) || 60);
const REGISTER_IP_MAX = Math.max(1, parseInt(process.env.REGISTER_IP_MAX, 10) || 40);

// Login: three stacked limiters for CGNAT safety + account protection
// 1) Per IP+email: 10 attempts / 15 min
// 2) Per account ceiling (login:acct:<email>): LOGIN_ACCT_MAX (default 60) / 15 min
// 3) Per IP ceiling: LOGIN_IP_MAX (default 300) / 15 min
const loginAccountLimiter = makeRateLimiter(
  15 * 60 * 1000,
  10,
  'Too many login attempts. Please try again in 15 minutes.',
  {
    keyGenerator: (req, ip) => {
      const email = typeof req.body?.email === 'string'
        ? req.body.email.trim().toLowerCase()
        : '';
      return email ? `login:${ip}:${email}` : `login:ip:${ip}`;
    },
  }
);
const loginAcctCeilingLimiter = makeRateLimiter(
  15 * 60 * 1000,
  LOGIN_ACCT_MAX,
  'Too many login attempts for this account. Please try again in 15 minutes.',
  {
    keyGenerator: (req, ip) => {
      const email = typeof req.body?.email === 'string'
        ? req.body.email.trim().toLowerCase()
        : '';
      return email ? `login:acct:${email}` : `login:ip:${ip}`;
    },
  }
);
const loginIpLimiter = makeRateLimiter(
  15 * 60 * 1000,
  LOGIN_IP_MAX,
  'Too many login attempts from this network. Please try again in 15 minutes.'
);

// Register: REGISTER_IP_MAX (default 40) / 60 min per IP + 3 / 60 min per email + silent honeypot
const registerIpLimiter = makeRateLimiter(
  60 * 60 * 1000,
  REGISTER_IP_MAX,
  'Too many registrations from this address. Please try again later.'
);
const registerEmailLimiter = makeRateLimiter(
  60 * 60 * 1000,
  3,
  'Too many registration attempts for this email. Please try again later.',
  {
    keyGenerator: (req, ip) => {
      const email = typeof req.body?.email === 'string'
        ? req.body.email.trim().toLowerCase()
        : '';
      return email ? `reg:email:${email}` : `reg:ip:${ip}`;
    },
  }
);
function registerHoneypot(req, res, next) {
  const trap = req.body?.website || req.body?.company_url || req.body?.hp;
  if (typeof trap === 'string' && trap.trim() !== '') {
    return res.status(201).json({ message: 'Registration successful' });
  }
  next();
}

const forgotPasswordLimiter = makeRateLimiter(60 * 60 * 1000, 5,  'Too many password reset requests. Please try again later.');
const forgotPasswordEmailLimiter = makeRateLimiter(
  60 * 60 * 1000,
  5,
  'Too many password reset requests for this email. Please try again later.',
  {
    keyGenerator: (req, ip) => {
      const email = typeof req.body?.email === 'string'
        ? req.body.email.trim().toLowerCase()
        : '';
      return email ? `fp:email:${email}` : `fp:ip:${ip}`;
    },
  }
);

// Refresh tokens are rotated on every use; an attacker with a valid token needs
// only one request. This limiter primarily blocks token-stuffing attempts.
const refreshLimiter = makeRateLimiter(15 * 60 * 1000, 20, 'Too many token refresh attempts. Please try again later.');

// OTP verification: 10 attempts per 15 minutes keyed on IP + email/phone (or mfa_token).
const otpLimiter = makeRateLimiter(
  15 * 60 * 1000,
  10,
  'Too many verification attempts. Please try again later.',
  {
    keyGenerator: (req, ip) => {
      const id = typeof req.body?.email === 'string' && req.body.email.trim()
        ? req.body.email.trim().toLowerCase()
        : typeof req.body?.phone === 'string' && req.body.phone.trim()
          ? req.body.phone.trim()
          : typeof req.body?.mfa_token === 'string' && req.body.mfa_token.trim()
            ? req.body.mfa_token.trim().slice(-16)
            : '';
      return id ? `otp:${ip}:${id}` : `otp:ip:${ip}`;
    },
  }
);

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
const customerController = require('../controllers/customer.controller');

router.post('/register',                  registerHoneypot, registerIpLimiter, registerEmailLimiter, validateRegister, register);
router.post('/login',                     loginIpLimiter,   loginAcctCeilingLimiter, loginAccountLimiter, validateLogin, login);
router.post('/verify-otp',                otpLimiter,             verifyOtp);
router.post('/refresh',                   refreshLimiter,         refresh);
router.get ('/me',                        verifyToken,            getMe);
router.get ('/profile',                   verifyToken,            customerController.getProfile);
router.put ('/profile',                   verifyToken,            customerController.updateProfile);
router.post('/logout',                    logoutLimiter,          logout);
router.post('/forgot-password',           forgotPasswordLimiter,  forgotPasswordEmailLimiter, forgotPassword);
router.get ('/verify-reset-token/:token', verifyResetTokenLimiter, verifyResetToken);
router.post('/reset-password',            resetPasswordLimiter,   resetPassword);

module.exports = router;

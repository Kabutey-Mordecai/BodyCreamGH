'use strict';

// Fail-fast production environment validation.
// Imported at the very top of server.js — before any route or middleware setup.
// Does nothing in development so local dev is unaffected.

const REQUIRED = [
  'JWT_SECRET',
  'OTP_HMAC_SECRET',
  'DB_PASSWORD',
  'PAYSTACK_SECRET_KEY',
  'ALLOWED_ORIGINS',
  'FRONTEND_URL',
  'BASE_URL',
];

const KNOWN_WEAK_JWT_SECRETS = new Set([
  'your_super_secret_key_change_this_in_production',
  'changeme',
  'secret',
  'your-secret',
  'CHANGE_ME_64_CHAR_HEX_STRING',
  'CHANGE_ME_OTP_HMAC_SECRET',
]);

function validateEnv() {
  if (!process.env.OTP_HMAC_SECRET) {
    process.stderr.write('\n[FATAL] OTP_HMAC_SECRET is not set. Set OTP_HMAC_SECRET in .env and restart.\n\n');
    process.exit(1);
  }

  if (process.env.NODE_ENV !== 'production') return;

  const errors = [];

  for (const key of REQUIRED) {
    if (!process.env[key]) {
      errors.push(`${key} is not set`);
    }
  }

  const jwt = process.env.JWT_SECRET || '';
  if (KNOWN_WEAK_JWT_SECRETS.has(jwt) || jwt.length < 32) {
    errors.push('JWT_SECRET must be at least 32 characters and must not be a default placeholder');
  }

  const otpSecret = process.env.OTP_HMAC_SECRET || '';
  if (KNOWN_WEAK_JWT_SECRETS.has(otpSecret) || otpSecret.length < 32) {
    errors.push('OTP_HMAC_SECRET must be at least 32 characters and must not be a default placeholder');
  }

  const dbPass = process.env.DB_PASSWORD || '';
  if (dbPass === 'CHANGE_ME' || dbPass.length < 8) {
    errors.push('DB_PASSWORD must be a strong password (8+ chars, not the placeholder)');
  }

  const paystackKey = process.env.PAYSTACK_SECRET_KEY || '';
  if (paystackKey.startsWith('sk_test_')) {
    errors.push('PAYSTACK_SECRET_KEY must be a live key (sk_live_...) in production — test keys are not accepted');
  }

  if (errors.length > 0) {
    process.stderr.write('\n[FATAL] Production environment validation failed:\n');
    for (const err of errors) {
      process.stderr.write(`  - ${err}\n`);
    }
    process.stderr.write('\nSet all required variables in .env and restart.\n\n');
    process.exit(1);
  }
}

validateEnv();

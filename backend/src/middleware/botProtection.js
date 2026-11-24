'use strict';

const logger = require('../utils/logger');

/**
 * Rejects automated form submissions that populate hidden honeypot fields.
 */
function rejectHoneypot(req, res, next) {
  const trap = req.body?.website || req.body?.company_url || req.body?.hp;
  if (typeof trap === 'string' && trap.trim() !== '') {
    logger.warn('Honeypot triggered', { path: req.originalUrl, ip: req.ip });
    return res.status(400).json({ error: 'Unable to process request' });
  }
  return next();
}

/**
 * Verifies Cloudflare Turnstile token when TURNSTILE_SECRET_KEY is configured.
 * If TURNSTILE_SECRET_KEY is unset, passes through so local/unconfigured envs keep working.
 */
async function verifyTurnstile(req, res, next) {
  const secret = (process.env.TURNSTILE_SECRET_KEY || '').trim();
  if (!secret) return next();

  const token =
    (typeof req.body?.cf_turnstile_response === 'string' && req.body.cf_turnstile_response.trim()) ||
    (typeof req.headers['cf-turnstile-response'] === 'string' && req.headers['cf-turnstile-response'].trim()) ||
    '';

  if (!token) {
    return res.status(400).json({ error: 'Please complete the human verification check and try again.' });
  }

  try {
    const body = new URLSearchParams({
      secret,
      response: token,
      ...(req.ip ? { remoteip: req.ip } : {}),
    });

    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(5000),
    });

    const data = await resp.json();
    if (!data?.success) {
      logger.warn('Turnstile verification failed', {
        path: req.originalUrl,
        ip: req.ip,
        codes: data?.['error-codes'],
      });
      return res.status(403).json({ error: 'Verification failed. Please refresh and try again.' });
    }
    return next();
  } catch (err) {
    logger.error('Turnstile verification error', { err: err.message, path: req.originalUrl });
    return res.status(503).json({ error: 'Verification service temporarily unavailable. Please try again.' });
  }
}

module.exports = {
  rejectHoneypot,
  verifyTurnstile,
};

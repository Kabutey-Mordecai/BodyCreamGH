'use strict';

/**
 * Fixed-window rate limiter (no external dependencies).
 * Tracks hits per IP in a Map. Each entry stores { count, resetAt } so the
 * server knows exactly how many seconds remain when it needs to send Retry-After.
 *
 * Every response (blocked or not) includes standard rate-limit headers so the
 * frontend can show a live countdown or "N attempts remaining" without guessing.
 *
 * @param {number} windowMs   - Window duration in milliseconds
 * @param {number} max        - Max requests allowed per IP per window
 * @param {string} message    - Error message returned on 429
 */
function makeRateLimiter(windowMs, max, message) {
  const store = new Map(); // key → { count, resetAt }

  const timer = setInterval(() => store.clear(), windowMs);
  if (timer.unref) timer.unref();

  return (req, res, next) => {
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const now  = Date.now();

    let entry = store.get(key);
    if (!entry) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count += 1;

    const remaining   = Math.max(0, max - entry.count);
    const resetSecs   = Math.ceil((entry.resetAt - now) / 1000);
    const retryAfter  = Math.max(0, resetSecs);

    // Standard rate-limit headers on every response.
    res.set('X-RateLimit-Limit',     String(max));
    res.set('X-RateLimit-Remaining', String(remaining));
    res.set('X-RateLimit-Reset',     String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > max) {
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        error:       message || 'Too many requests. Please try again later.',
        retryAfter,  // seconds — convenience field so frontend doesn't parse headers
      });
    }

    next();
  };
}

module.exports = { makeRateLimiter };

'use strict';

/**
 * Per-key fixed-window rate limiter (no external dependencies).
 *
 * Security properties:
 * - Each IP key tracks its own { count, resetAt } window and resets individually
 *   when `now >= entry.resetAt` (no global wipe boundary burst).
 * - Expired entries are swept periodically to reclaim memory.
 * - Store size is bounded (`maxKeys`, default 10,000). When full after sweeping
 *   expired keys, new unknown keys fail CLOSED with 429 rather than evicting
 *   existing tracked attackers (preventing limit-flush attacks).
 *
 * @param {number} windowMs   - Window duration in milliseconds
 * @param {number} max        - Max requests allowed per IP per window
 * @param {string} message    - Error message returned on 429
 * @param {object} [options]  - Optional { maxKeys }
 */
function makeRateLimiter(windowMs, max, message, options = {}) {
  const maxKeys = Number.isInteger(options.maxKeys) && options.maxKeys > 0
    ? options.maxKeys
    : 10_000;
  const store = new Map(); // key → { count, resetAt }

  function sweepExpired(now) {
    for (const [k, v] of store.entries()) {
      if (now >= v.resetAt) {
        store.delete(k);
      }
    }
  }

  const sweepInterval = Math.min(windowMs, 60_000);
  const timer = setInterval(() => sweepExpired(Date.now()), sweepInterval);
  if (timer.unref) timer.unref();

  return (req, res, next) => {
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();

    let entry = store.get(key);
    if (entry && now >= entry.resetAt) {
      store.delete(key);
      entry = undefined;
    }

    if (!entry) {
      if (store.size >= maxKeys) {
        sweepExpired(now);
      }
      if (store.size >= maxKeys) {
        const retryAfter = Math.max(1, Math.ceil(windowMs / 1000));
        res.set('X-RateLimit-Limit',     String(max));
        res.set('X-RateLimit-Remaining', '0');
        res.set('Retry-After',           String(retryAfter));
        return res.status(429).json({
          error: message || 'Too many requests. Please try again later.',
          retryAfter,
        });
      }
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count += 1;

    const remaining  = Math.max(0, max - entry.count);
    const resetSecs  = Math.ceil((entry.resetAt - now) / 1000);
    const retryAfter = Math.max(0, resetSecs);

    res.set('X-RateLimit-Limit',     String(max));
    res.set('X-RateLimit-Remaining', String(remaining));
    res.set('X-RateLimit-Reset',     String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > max) {
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: message || 'Too many requests. Please try again later.',
        retryAfter,
      });
    }

    next();
  };
}

module.exports = { makeRateLimiter };

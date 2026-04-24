/**
 * Lightweight fixed-window rate limiter (no external dependencies).
 * Tracks hits per IP address in a Map, cleared every `windowMs` milliseconds.
 *
 * @param {number} windowMs   - Window duration in milliseconds
 * @param {number} max        - Max requests allowed per IP per window
 * @param {string} message    - Error message returned on 429
 */
function makeRateLimiter(windowMs, max, message) {
  const hits = new Map();
  const timer = setInterval(() => hits.clear(), windowMs);
  if (timer.unref) timer.unref(); // don't keep the process alive for this timer

  return (req, res, next) => {
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const count = (hits.get(key) || 0) + 1;
    hits.set(key, count);

    if (count > max) {
      return res.status(429).json({
        error: message || 'Too many requests. Please try again later.',
      });
    }
    next();
  };
}

module.exports = { makeRateLimiter };

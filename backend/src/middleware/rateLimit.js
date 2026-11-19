'use strict';

const net = require('net');

/**
 * Normalize an IP address for rate-limit keying.
 * - Unwraps IPv4-mapped IPv6 addresses (::ffff:1.2.3.4 → 1.2.3.4).
 * - Masks IPv6 addresses to their /64 prefix so a single /64 allocation
 *   cannot bypass limits or exhaust the store by rotating interface IDs.
 */
function normalizeIp(rawIp) {
  if (!rawIp || typeof rawIp !== 'string') return 'unknown';
  let ip = rawIp.trim();
  const zoneIdx = ip.indexOf('%');
  if (zoneIdx !== -1) ip = ip.slice(0, zoneIdx);
  if (ip.toLowerCase().startsWith('::ffff:')) {
    ip = ip.slice(7);
  }

  if (net.isIP(ip) === 6) {
    // Convert trailing IPv4-embedded notation if present
    let working = ip;
    if (working.includes('.')) {
      const lastColon = working.lastIndexOf(':');
      const ipv4Part = working.slice(lastColon + 1);
      if (net.isIP(ipv4Part) === 4) {
        const octets = ipv4Part.split('.').map(n => parseInt(n, 10));
        const hi = ((octets[0] << 8) | octets[1]).toString(16);
        const lo = ((octets[2] << 8) | octets[3]).toString(16);
        working = `${working.slice(0, lastColon)}:${hi}:${lo}`;
      }
    }

    const halves = working.split('::');
    let groups;
    if (halves.length === 2) {
      const left = halves[0] ? halves[0].split(':') : [];
      const right = halves[1] ? halves[1].split(':') : [];
      const missing = Math.max(0, 8 - left.length - right.length);
      groups = [...left, ...Array(missing).fill('0'), ...right];
    } else {
      groups = working.split(':');
    }
    const padded = groups.slice(0, 8).map(g => g.padStart(4, '0').toLowerCase());
    return `${padded.slice(0, 4).join(':')}::/64`;
  }

  return ip || 'unknown';
}

/**
 * Per-key fixed-window rate limiter with LRU eviction (no external dependencies).
 *
 * Security & availability properties:
 * - IPv6 clients are keyed by their /64 prefix via normalizeIp().
 * - Store size is bounded (`maxKeys`, default 10,000). When full after sweeping
 *   expired keys, least-recently-used entries are evicted so legitimate clients
 *   are not globally locked out.
 *
 * @param {number} windowMs   - Window duration in milliseconds
 * @param {number} max        - Max requests allowed per key per window
 * @param {string} message    - Error message returned on 429
 * @param {object} [options]  - Optional { maxKeys, keyGenerator(req, normalizedIp) }
 */
function makeRateLimiter(windowMs, max, message, options = {}) {
  const maxKeys = Number.isInteger(options.maxKeys) && options.maxKeys > 0
    ? options.maxKeys
    : 10_000;
  const keyGenerator = typeof options.keyGenerator === 'function'
    ? options.keyGenerator
    : (_req, ip) => ip;
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
    const ip = normalizeIp(req.ip || req.socket?.remoteAddress || 'unknown');
    const key = String(keyGenerator(req, ip) || ip);
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
      while (store.size >= maxKeys) {
        const oldestKey = store.keys().next().value;
        if (oldestKey === undefined) break;
        store.delete(oldestKey);
      }
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    } else {
      // Refresh insertion order for LRU eviction
      store.delete(key);
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

module.exports = { makeRateLimiter, normalizeIp };

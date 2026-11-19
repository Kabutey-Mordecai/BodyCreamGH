'use strict';

const axios = require('axios');

const secretKey = process.env.PAYSTACK_SECRET_KEY;
if (!secretKey) {
  throw new Error('PAYSTACK_SECRET_KEY environment variable is required');
}

const MAX_GET_RETRIES = 3;
const RETRYABLE_NET_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED']);

const paystackAPI = axios.create({
  baseURL: 'https://api.paystack.co',
  timeout: 10_000,
  maxRedirects: 5,
  headers: {
    Authorization: `Bearer ${secretKey}`,
    'Content-Type': 'application/json',
  },
});

function computeRetryDelayMs(error, retryCount) {
  const status = error.response?.status;
  if (status === 429) {
    const headers = error.response.headers || {};
    const retryAfterRaw = headers['retry-after'];
    if (retryAfterRaw !== undefined) {
      const secs = Number(retryAfterRaw);
      if (Number.isFinite(secs) && secs >= 0) {
        return Math.min(5000, Math.max(250, secs * 1000));
      }
    }
    const resetRaw = headers['x-ratelimit-reset'];
    if (resetRaw !== undefined) {
      const resetSecs = Number(resetRaw);
      if (Number.isFinite(resetSecs)) {
        const deltaMs = resetSecs * 1000 - Date.now();
        if (deltaMs > 0) return Math.min(5000, deltaMs);
      }
    }
  }
  return Math.min(5000, 500 * (2 ** (retryCount - 1)));
}

paystackAPI.interceptors.response.use(
  res => res,
  async (error) => {
    const cfg = error.config;
    if (!cfg || (cfg.method || '').toLowerCase() !== 'get') {
      return Promise.reject(error);
    }

    const status = error.response?.status;
    const isRetryable = status === 429 || (status >= 500 && status < 600) || RETRYABLE_NET_CODES.has(error.code);
    if (!isRetryable) {
      return Promise.reject(error);
    }

    cfg._retryCount = (cfg._retryCount || 0) + 1;
    if (cfg._retryCount > MAX_GET_RETRIES) {
      return Promise.reject(error);
    }

    const delayMs = computeRetryDelayMs(error, cfg._retryCount);
    await new Promise(resolve => setTimeout(resolve, delayMs));
    return paystackAPI(cfg);
  }
);

module.exports = paystackAPI;

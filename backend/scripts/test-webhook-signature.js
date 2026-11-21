'use strict';

require('dotenv').config();
const assert = require('assert');
const crypto = require('crypto');

// Ensure a secret key is present for deterministic signing in the test
process.env.PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || 'sk_test_webhook_sig_test_only';

const { handleWebhook } = require('../src/controllers/payment.controller');

function makeRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

async function callWebhook(payloadObj, signatureHeader) {
  const rawBody = Buffer.from(JSON.stringify(payloadObj), 'utf8');
  const headers = {};
  if (signatureHeader !== undefined) {
    headers['x-paystack-signature'] = signatureHeader;
  }
  const req = {
    headers,
    rawBody,
    body: payloadObj,
  };
  const res = makeRes();
  await handleWebhook(req, res);
  return res;
}

async function run() {
  const samplePayload = {
    event: 'refund.pending',
    data: { reference: 'rf_test_123', transaction_reference: 'tx_test_123' },
  };

  // 1. Missing signature header -> 401
  const rMissing = await callWebhook(samplePayload, undefined);
  assert.strictEqual(rMissing.statusCode, 401, `Expected 401 for missing header, got ${rMissing.statusCode}`);

  // 2. Non-hex malformed signature -> 401 (never 500)
  const rNonHex = await callWebhook(samplePayload, 'not-valid-hex!!!');
  assert.strictEqual(rNonHex.statusCode, 401, `Expected 401 for non-hex signature, got ${rNonHex.statusCode}`);

  // 3. Too-short valid hex -> 401 (length check before timingSafeEqual prevents RangeError/500)
  const rShortHex = await callWebhook(samplePayload, 'deadbeef');
  assert.strictEqual(rShortHex.statusCode, 401, `Expected 401 for short hex signature, got ${rShortHex.statusCode}`);

  // 4. Odd-length hex -> 401
  const rOddHex = await callWebhook(samplePayload, 'abc');
  assert.strictEqual(rOddHex.statusCode, 401, `Expected 401 for odd-length hex signature, got ${rOddHex.statusCode}`);

  // 5. Correct length (128 hex chars = 64 bytes) but wrong digest -> 401
  const rWrongDigest = await callWebhook(samplePayload, 'a'.repeat(128));
  assert.strictEqual(rWrongDigest.statusCode, 401, `Expected 401 for wrong digest, got ${rWrongDigest.statusCode}`);

  // 6. Valid HMAC-SHA512 signature -> 200
  const rawBuf = Buffer.from(JSON.stringify(samplePayload), 'utf8');
  const validSig = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(rawBuf)
    .digest('hex');
  const rValid = await callWebhook(samplePayload, validSig);
  assert.strictEqual(rValid.statusCode, 200, `Expected 200 for valid signature, got ${rValid.statusCode}`);

  console.log('ALL PAYSTACK WEBHOOK SIGNATURE TESTS PASSED (6/6)');
}

run().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});

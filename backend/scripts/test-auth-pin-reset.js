'use strict';

require('dotenv').config();
const assert = require('assert');
const { randomUUID: uuid } = require('crypto');
const pool = require('../src/config/database');
const auth = require('../src/controllers/auth.controller');

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.body = data; return res; };
  return res;
}

async function run() {
  // 1. Constant-time hash verification unit checks
  const samplePin = '482915';
  const digest = auth._hashResetPin(samplePin);
  assert.strictEqual(digest.length, 64, 'PIN hash must be 64-char hex HMAC-SHA256');
  assert.notStrictEqual(digest, samplePin, 'PIN must be hashed at rest');
  assert.strictEqual(auth._verifyResetPinHash(samplePin, digest), true);
  assert.strictEqual(auth._verifyResetPinHash('000000', digest), false);
  assert.strictEqual(auth._verifyResetPinHash(samplePin, 'short'), false);

  // 2. End-to-end DB test with temporary test user (cleaned up in finally)
  const testUserId = uuid();
  const testEmail = `pin_test_${Date.now()}@example.com`;
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role)
     VALUES ($1, $2, '$2b$10$abcdefghijklmnopqrstuv', 'Pin', 'Tester', 'customer')`,
    [testUserId, testEmail]
  );

  try {
    // 2a. Nonexistent email returns identical generic error on verify
    const resUnknown = mockRes();
    await auth.verifyResetToken({ params: { token: '123456' }, query: { email: 'no_such_user@example.com' } }, resUnknown);
    assert.strictEqual(resUnknown.statusCode, 400);

    // 2b. Insert hashed PIN and verify 5 failed attempts invalidate it
    const pin1 = '654321';
    const hash1 = auth._hashResetPin(pin1);
    const id1 = uuid();
    await pool.query(
      `INSERT INTO password_reset_tokens (id, user_id, token, expires_at, used, attempts)
       VALUES ($1, $2, $3, NOW() + INTERVAL '15 minutes', false, 0)`,
      [id1, testUserId, hash1]
    );

    for (let i = 1; i <= 5; i++) {
      const r = mockRes();
      await auth.verifyResetToken({ params: { token: '999999' }, query: { email: testEmail } }, r);
      assert.strictEqual(r.statusCode, 400);
      assert.strictEqual(r.body.error, resUnknown.body.error, 'Wrong PIN and unknown email must return identical error');
    }

    // After 5 wrong attempts, even the real PIN must fail and row must be marked used=true
    const { rows: after5 } = await pool.query('SELECT used, attempts FROM password_reset_tokens WHERE id = $1', [id1]);
    assert.strictEqual(after5[0].used, true, 'PIN must be invalidated after 5 failed attempts');
    assert.strictEqual(after5[0].attempts, 5);

    const rAfterLock = mockRes();
    await auth.verifyResetToken({ params: { token: pin1 }, query: { email: testEmail } }, rAfterLock);
    assert.strictEqual(rAfterLock.statusCode, 400, 'Invalidated PIN must be rejected');

    // 2c. Valid PIN verifies, resets password once, and cannot be reused
    const pin2 = '135792';
    const hash2 = auth._hashResetPin(pin2);
    const id2 = uuid();
    await pool.query(
      `INSERT INTO password_reset_tokens (id, user_id, token, expires_at, used, attempts)
       VALUES ($1, $2, $3, NOW() + INTERVAL '15 minutes', false, 0)`,
      [id2, testUserId, hash2]
    );

    const rValid = mockRes();
    await auth.verifyResetToken({ params: { token: pin2 }, query: { email: testEmail } }, rValid);
    assert.strictEqual(rValid.statusCode, 200);
    assert.strictEqual(rValid.body.valid, true);

    const rReset = mockRes();
    await auth.resetPassword({ body: { token: pin2, email: testEmail, new_password: 'NewStrongPassword1!' } }, rReset);
    assert.strictEqual(rReset.statusCode, 200);

    // Replay must fail (single-use)
    const rReplay = mockRes();
    await auth.resetPassword({ body: { token: pin2, email: testEmail, new_password: 'AnotherPassword2!' } }, rReplay);
    assert.strictEqual(rReplay.statusCode, 400, 'Replayed PIN must be rejected');

    console.log('ALL 6-DIGIT PIN PASSWORD RESET TESTS PASSED');
  } finally {
    await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [testUserId]);
    await pool.query('DELETE FROM users WHERE id = $1', [testUserId]);
    await pool.end();
  }
}

run().catch(err => {
  console.error('PIN RESET TEST FAILURE:', err);
  process.exit(1);
});

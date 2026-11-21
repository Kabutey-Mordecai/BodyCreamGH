'use strict';

require('dotenv').config();
const assert = require('assert');
const jwt = require('jsonwebtoken');
const { randomUUID: uuid } = require('crypto');
const pool = require('../src/config/database');
const { verifyToken, requireAdmin } = require('../src/middleware/auth');

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
  };
}

async function runMiddlewareChain(token) {
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = makeRes();
  let passedVerify = false;
  let passedAdmin = false;

  await verifyToken(req, res, () => { passedVerify = true; });
  if (!passedVerify) return { res, passedVerify, passedAdmin };

  await requireAdmin(req, res, () => { passedAdmin = true; });
  return { res, passedVerify, passedAdmin };
}

async function run() {
  const adminId = uuid();
  const email = `require-admin-test-${Date.now()}@example.test`;

  try {
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_active)
       VALUES ($1, $2, 'not_used_in_test', 'Admin', 'Test', 'admin', true)`,
      [adminId, email]
    );

    const token = jwt.sign(
      { id: adminId, email, role: 'admin', jti: uuid() },
      process.env.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '15m' }
    );

    // 1. Active admin with valid token -> allowed
    const rActive = await runMiddlewareChain(token);
    assert.strictEqual(rActive.passedVerify, true);
    assert.strictEqual(rActive.passedAdmin, true, 'Active admin must pass requireAdmin');

    // 2. Deactivated admin with the SAME valid token -> rejected with 401
    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [adminId]);
    const rDeactivated = await runMiddlewareChain(token);
    assert.strictEqual(rDeactivated.passedVerify, true);
    assert.strictEqual(rDeactivated.passedAdmin, false, 'Deactivated admin must NOT pass requireAdmin');
    assert.strictEqual(rDeactivated.res.statusCode, 401, `Expected 401 for deactivated admin, got ${rDeactivated.res.statusCode}`);

    // 3. Re-activated but demoted to customer with the SAME valid admin JWT -> rejected with 403
    await pool.query("UPDATE users SET is_active = true, role = 'customer' WHERE id = $1", [adminId]);
    const rDemoted = await runMiddlewareChain(token);
    assert.strictEqual(rDemoted.passedVerify, true);
    assert.strictEqual(rDemoted.passedAdmin, false, 'Demoted admin must NOT pass requireAdmin');
    assert.strictEqual(rDemoted.res.statusCode, 403, `Expected 403 for demoted admin, got ${rDemoted.res.statusCode}`);

    console.log('ALL REQUIRE_ADMIN DB ENFORCEMENT TESTS PASSED (3/3)');
  } finally {
    await pool.query('DELETE FROM users WHERE id = $1', [adminId]).catch(() => {});
    await pool.end();
  }
}

run().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});

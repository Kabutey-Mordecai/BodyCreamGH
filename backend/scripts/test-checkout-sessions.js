'use strict';

require('dotenv').config();
const assert = require('assert');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
const { randomUUID: uuid } = require('crypto');

const testUrl = (process.env.TEST_DATABASE_URL || '').trim();
if (!testUrl) {
  console.error('[FATAL] TEST_DATABASE_URL must be set');
  process.exit(1);
}
process.env.DATABASE_URL = testUrl;

const pool = require('../src/config/database');
const ordersRoutes = require('../src/routes/orders');
const emailService = require('../src/services/email.service');
const { purgeCheckoutSessions } = require('../src/workers/order.expiry.worker');

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, jti: uuid(), type: 'access' },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '15m' }
  );
}

async function reqJson(baseUrl, method, path, token, body = null) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

async function main() {
  // Stub emailService.sendEmail so test does not hit SMTP
  const origSendEmail = emailService.sendEmail;
  let sentEmails = 0;
  let lastEmailHtml = '';
  emailService.sendEmail = async (opts) => {
    sentEmails++;
    lastEmailHtml = opts?.html || '';
    return { messageId: 'mock-msg' };
  };

  const app = express();
  app.use(express.json());
  app.use('/api/orders', ordersRoutes);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const adminId = uuid();
  const custId = uuid();
  const tokenBase = `cs-test-${Date.now()}`;
  const createdSessionIds = [];
  const dummyOrderId = uuid();

  try {
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, role, is_active)
       VALUES ($1, $2, 'hash', 'Admin', 'admin', TRUE),
              ($3, $4, 'hash', 'Cust', 'customer', TRUE)`,
      [adminId, `cs-admin-${Date.now()}@example.com`, custId, `cs-cust-${Date.now()}@example.com`]
    );
    const adminToken = signToken({ id: adminId, email: 'admin@example.com', role: 'admin' });
    const custToken = signToken({ id: custId, email: 'cust@example.com', role: 'customer' });

    // 1. No consent -> 400 and nothing stored
    const noConsent = await reqJson(baseUrl, 'POST', '/api/orders/checkout-session', null, {
      session_token: `${tokenBase}-noconsent`,
      email: 'noconsent@example.com',
      consent: false,
      subtotal: 100,
      items: [{ name: 'Shea', quantity: 1, price: 100 }],
    });
    assert.strictEqual(noConsent.status, 400);
    const dbCheck0 = await pool.query(
      `SELECT id FROM checkout_sessions WHERE session_token = $1`,
      [`${tokenBase}-noconsent`]
    );
    assert.strictEqual(dbCheck0.rows.length, 0, 'No consent must not store contact details');

    // 2. Oversized items (>50) -> 400
    const tooMany = await reqJson(baseUrl, 'POST', '/api/orders/checkout-session', null, {
      session_token: `${tokenBase}-big`,
      email: 'big@example.com',
      consent: true,
      subtotal: 100,
      items: Array.from({ length: 51 }, (_, i) => ({ name: `Item ${i}`, quantity: 1, price: 1 })),
    });
    assert.strictEqual(tooMany.status, 400);

    // 3. Valid consent -> 200 and stored
    const ok = await reqJson(baseUrl, 'POST', '/api/orders/checkout-session', null, {
      session_token: `${tokenBase}-ok`,
      email: 'consent@example.com',
      first_name: 'Ama',
      consent: true,
      subtotal: 150,
      step_reached: 'shipping',
      items: [{ name: 'Shea Butter', quantity: 1, price: 150 }],
    });
    assert.strictEqual(ok.status, 200);
    const sessRow = await pool.query(
      `SELECT id FROM checkout_sessions WHERE session_token = $1`,
      [`${tokenBase}-ok`]
    );
    assert.strictEqual(sessRow.rows.length, 1);
    const sessionId = sessRow.rows[0].id;
    createdSessionIds.push(sessionId);

    // 4. Remind endpoint: customer -> 403, admin -> 200 once, second call -> 409, audit logged
    const custRemind = await reqJson(baseUrl, 'POST', `/api/orders/admin/abandoned/${sessionId}/remind`, custToken);
    assert.strictEqual(custRemind.status, 403);

    const adminRemind1 = await reqJson(baseUrl, 'POST', `/api/orders/admin/abandoned/${sessionId}/remind`, adminToken);
    assert.strictEqual(adminRemind1.status, 200);
    assert.strictEqual(sentEmails, 1);
    assert.ok(lastEmailHtml.includes('/api/orders/checkout-session/opt-out?token='), 'Reminder email must include opt-out link');

    const adminRemind2 = await reqJson(baseUrl, 'POST', `/api/orders/admin/abandoned/${sessionId}/remind`, adminToken);
    assert.strictEqual(adminRemind2.status, 409, 'Second reminder for same session must be blocked');
    assert.strictEqual(sentEmails, 1);

    const auditRes = await pool.query(
      `SELECT action FROM admin_audit_logs WHERE actor_id = $1 AND resource_id = $2`,
      [adminId, sessionId]
    );
    assert.ok(auditRes.rows.some(r => r.action === 'abandoned_checkout.remind'));

    // 5. Retention purge: >30d old & recovered >24h old purged; fresh kept
    const oldId = uuid();
    const recId = uuid();
    createdSessionIds.push(oldId, recId);
    await pool.query(
      `INSERT INTO orders (id, order_number, total_amount, status, payment_status)
       VALUES ($1, $2, 50, 'confirmed', 'paid')`,
      [dummyOrderId, `CS-ORD-${Date.now()}`]
    );
    await pool.query(
      `INSERT INTO checkout_sessions (id, session_token, email, subtotal, created_at, updated_at)
       VALUES ($1, $2, 'old@example.com', 50, NOW() - INTERVAL '35 days', NOW() - INTERVAL '35 days')`,
      [oldId, `${tokenBase}-old`]
    );
    await pool.query(
      `INSERT INTO checkout_sessions (id, session_token, email, subtotal, recovered_order_id, created_at, updated_at)
       VALUES ($1, $2, 'rec@example.com', 50, $3, NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days')`,
      [recId, `${tokenBase}-rec`, dummyOrderId]
    );

    const purgeRes = await purgeCheckoutSessions();
    assert.ok(purgeRes.purgedCount >= 2);
    const left = await pool.query(
      `SELECT id FROM checkout_sessions WHERE id = ANY($1::uuid[])`,
      [[oldId, recId, sessionId]]
    );
    assert.deepStrictEqual(left.rows.map(r => r.id), [sessionId], 'Only fresh unrecovered session remains');

    // 6. IP rate limiter (>15 requests -> 429)
    let hit429 = false;
    for (let i = 0; i < 16; i++) {
      const r = await reqJson(baseUrl, 'POST', '/api/orders/checkout-session', null, {
        session_token: `${tokenBase}-rl-${i}`,
        email: 'rl@example.com',
        consent: false,
      });
      if (r.status === 429) {
        hit429 = true;
        break;
      }
    }
    assert.ok(hit429, 'POST /api/orders/checkout-session must enforce per-IP rate limit');

    // 7. Customer opt-out flow: GET displays confirmation page and does NOT delete; POST performs deletion
    const delToken = `${tokenBase}-del`;
    await pool.query(
      `INSERT INTO checkout_sessions (id, session_token, email, subtotal) VALUES ($1, $2, 'del@example.com', 50)`,
      [uuid(), delToken]
    );

    // 7a. GET returns 200 with confirmation form and leaves row in DB untouched
    const getRes = await fetch(`${baseUrl}/api/orders/checkout-session/opt-out?token=${encodeURIComponent(delToken)}`);
    assert.strictEqual(getRes.status, 200, 'GET opt-out must return 200 confirmation page');
    const getHtml = await getRes.text();
    assert.ok(getHtml.includes('Opt Out of Cart Reminders'), 'GET must show opt-out title');
    assert.ok(getHtml.includes('<form method="POST" action="/api/orders/checkout-session/opt-out"'), 'GET must render POST form');
    const afterGet = await pool.query(`SELECT id FROM checkout_sessions WHERE session_token = $1`, [delToken]);
    assert.strictEqual(afterGet.rows.length, 1, 'GET opt-out must NOT delete checkout_session row');

    // 7b. POST with token performs single-purpose deletion
    const postRes = await fetch(`${baseUrl}/api/orders/checkout-session/opt-out`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ token: delToken }),
    });
    assert.strictEqual(postRes.status, 200, 'POST opt-out must return 200');
    const postJson = await postRes.json();
    assert.strictEqual(postJson.deleted, true, 'POST opt-out must report deleted: true');
    const afterPost = await pool.query(`SELECT id FROM checkout_sessions WHERE session_token = $1`, [delToken]);
    assert.strictEqual(afterPost.rows.length, 0, 'POST opt-out must delete checkout_session row');

    // 7c. Repeated POST returns 404
    const postAgainRes = await fetch(`${baseUrl}/api/orders/checkout-session/opt-out`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ token: delToken }),
    });
    const postAgainJson = await postAgainRes.json();
    assert.strictEqual(postAgainJson.deleted, false, 'Repeated POST opt-out must return deleted: false');

    // 7d. DELETE /api/orders/checkout-session directly
    const directToken = `${tokenBase}-direct`;
    await pool.query(
      `INSERT INTO checkout_sessions (id, session_token, email, subtotal) VALUES ($1, $2, 'direct@example.com', 75)`,
      [uuid(), directToken]
    );
    const delApiRes = await fetch(`${baseUrl}/api/orders/checkout-session`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_token: directToken }),
    });
    assert.strictEqual(delApiRes.status, 200);
    const afterDirect = await pool.query(`SELECT id FROM checkout_sessions WHERE session_token = $1`, [directToken]);
    assert.strictEqual(afterDirect.rows.length, 0, 'DELETE /api/orders/checkout-session must delete row');

    console.log('ALL CHECKOUT SESSION PRIVACY, RETENTION, RATE-LIMIT & REMINDER TESTS PASSED');
  } finally {
    emailService.sendEmail = origSendEmail;
    server.close();
    await pool.query(`DELETE FROM checkout_sessions WHERE id = ANY($1::uuid[])`, [createdSessionIds]).catch(() => {});
    await pool.query(`DELETE FROM orders WHERE id = $1`, [dummyOrderId]).catch(() => {});
    await pool.query(`DELETE FROM admin_audit_logs WHERE actor_id = $1`, [adminId]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[adminId, custId]]).catch(() => {});
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

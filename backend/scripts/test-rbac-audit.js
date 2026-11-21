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
const adminRoutes = require('../src/routes/admin');
const ordersRoutes = require('../src/routes/orders');
const settingsRoutes = require('../src/routes/settings');
const productsRoutes = require('../src/routes/products');
const couponsRoutes = require('../src/routes/coupons');
const inventoryRoutes = require('../src/routes/inventory');

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
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes);
  app.use('/api/orders', ordersRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/products', productsRoutes);
  app.use('/api/coupons', couponsRoutes);
  app.use('/api/inventory', inventoryRoutes);

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const roles = ['super_admin', 'admin', 'fulfillment', 'support', 'marketing', 'customer'];
  const users = {};
  const tokens = {};
  const createdCouponIds = [];

  try {
    for (const r of roles) {
      const id = uuid();
      const email = `rbac-${r}-${Date.now()}@example.com`;
      await pool.query(
        `INSERT INTO users (id, email, password_hash, first_name, role, is_active)
         VALUES ($1, $2, 'hash', $3, $4, TRUE)`,
        [id, email, r, r]
      );
      users[r] = { id, email, role: r };
      tokens[r] = signToken(users[r]);
    }

    // 1. super_admin allowed on all admin/sensitive routes
    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/admin/financials', tokens.super_admin)).status, 200);
    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/admin/accounts', tokens.super_admin)).status, 200);
    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/admin/audit-logs', tokens.super_admin)).status, 200);
    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/orders/admin/export', tokens.super_admin)).status, 200);
    assert.strictEqual((await reqJson(baseUrl, 'PUT', '/api/settings', tokens.super_admin, { key: 'rbac_test_key', value: 'ok' })).status, 200);

    // 2. admin allowed on financials/accounts/audit-logs/settings, but BLOCKED (403) on role change
    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/admin/financials', tokens.admin)).status, 200);
    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/admin/audit-logs', tokens.admin)).status, 200);
    assert.strictEqual((await reqJson(baseUrl, 'PATCH', `/api/admin/accounts/${users.support.id}/role`, tokens.admin, { role: 'super_admin' })).status, 403);

    // 3. fulfillment: 200 on inventory & orders; 403 on financials, accounts, audit-logs, customers, export, settings, refunds
    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/inventory', tokens.fulfillment)).status, 200);
    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/orders/admin/all', tokens.fulfillment)).status, 200);
    for (const p of ['/api/admin/financials', '/api/admin/accounts', '/api/admin/audit-logs', '/api/admin/customers', '/api/orders/admin/export']) {
      assert.strictEqual((await reqJson(baseUrl, 'GET', p, tokens.fulfillment)).status, 403, `fulfillment must get 403 on ${p}`);
    }
    assert.strictEqual((await reqJson(baseUrl, 'PUT', '/api/settings', tokens.fulfillment, { key: 'x', value: 'y' })).status, 403);
    assert.strictEqual((await reqJson(baseUrl, 'POST', `/api/orders/${uuid()}/refund`, tokens.fulfillment, { amount: 10 })).status, 403);

    // 4. support: 200 on orders, reviews, abandoned; 403 on financials, accounts, audit-logs, customers, export, settings, refunds
    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/orders/admin/all', tokens.support)).status, 200);
    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/admin/reviews', tokens.support)).status, 200);
    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/orders/admin/abandoned', tokens.support)).status, 200);
    for (const p of ['/api/admin/financials', '/api/admin/accounts', '/api/admin/audit-logs', '/api/admin/customers', '/api/orders/admin/export']) {
      assert.strictEqual((await reqJson(baseUrl, 'GET', p, tokens.support)).status, 403, `support must get 403 on ${p}`);
    }
    assert.strictEqual((await reqJson(baseUrl, 'PUT', '/api/settings', tokens.support, { key: 'x', value: 'y' })).status, 403);

    // 5. marketing: 200 on products/admin, coupons, promotions; 403 on financials, accounts, audit-logs, customers, subscriber PII, export, settings
    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/products/admin', tokens.marketing)).status, 200);
    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/coupons', tokens.marketing)).status, 200);
    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/admin/promotions', tokens.marketing)).status, 200);
    for (const p of ['/api/admin/financials', '/api/admin/accounts', '/api/admin/audit-logs', '/api/admin/customers', '/api/admin/newsletter/subscribers', '/api/orders/admin/export']) {
      assert.strictEqual((await reqJson(baseUrl, 'GET', p, tokens.marketing)).status, 403, `marketing must get 403 on ${p}`);
    }

    // 6. customer: 403 on admin routes
    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/admin/dashboard', tokens.customer)).status, 403);
    assert.strictEqual((await reqJson(baseUrl, 'GET', '/api/orders/admin/all', tokens.customer)).status, 403);

    // 7. Self-role change & self-deactivation blocked
    assert.strictEqual((await reqJson(baseUrl, 'PATCH', `/api/admin/accounts/${users.super_admin.id}/role`, tokens.super_admin, { role: 'admin' })).status, 400);
    assert.strictEqual((await reqJson(baseUrl, 'PATCH', `/api/admin/accounts/${users.admin.id}/deactivate`, tokens.admin)).status, 400);

    // 8. super_admin can change another user's role & audit log records it without secrets
    const roleRes = await reqJson(baseUrl, 'PATCH', `/api/admin/accounts/${users.marketing.id}/role`, tokens.super_admin, { role: 'support' });
    assert.strictEqual(roleRes.status, 200);
    assert.strictEqual(roleRes.data.role, 'support');

    const cCode = `AUD${Date.now().toString().slice(-6)}`;
    const cRes = await reqJson(baseUrl, 'POST', '/api/coupons', tokens.admin, { code: cCode, type: 'fixed', value: 5 });
    assert.strictEqual(cRes.status, 201);
    if (cRes.data?.id) createdCouponIds.push(cRes.data.id);

    const auditRes = await reqJson(baseUrl, 'GET', '/api/admin/audit-logs?limit=20', tokens.super_admin);
    assert.strictEqual(auditRes.status, 200);
    const actions = auditRes.data.logs.map(l => l.action);
    assert.ok(actions.includes('settings.update'), 'audit log must record settings.update');
    assert.ok(actions.includes('admin.account.role_change'), 'audit log must record role_change');
    assert.ok(actions.includes('coupon.create'), 'audit log must record coupon.create');

    console.log('ALL RBAC & AUDIT LOG TESTS PASSED');
  } finally {
    server.close();
    if (createdCouponIds.length) {
      await pool.query(`DELETE FROM coupons WHERE id = ANY($1::uuid[])`, [createdCouponIds]).catch(() => {});
    }
    await pool.query(`DELETE FROM site_settings WHERE key = 'rbac_test_key'`).catch(() => {});
    await pool.query(`DELETE FROM admin_audit_logs WHERE actor_id = ANY($1::uuid[])`, [Object.values(users).map(u => u.id)]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [Object.values(users).map(u => u.id)]).catch(() => {});
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

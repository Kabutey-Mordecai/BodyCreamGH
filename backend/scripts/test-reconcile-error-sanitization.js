'use strict';

require('dotenv').config();
const assert = require('assert');
const crypto = require('crypto');
const axios = require('axios');
const { PgBoss } = require('pg-boss');
const pool = require('../src/config/database');
const paystackAPI = require('../src/config/paystack');
const registerReconciliationWorker = require('../src/workers/reconciliation.worker');

const FORBIDDEN_PATTERNS = [/authorization/i, /bearer/i, /"config"\s*:/i];

function assertNoSecretLeak(label, text) {
  for (const re of FORBIDDEN_PATTERNS) {
    assert.strictEqual(
      re.test(text),
      false,
      `${label} leaked forbidden pattern ${re}: ${text}`
    );
  }
}

async function run() {
  const originalAdapter = paystackAPI.defaults.adapter;
  const fakeSecret = 'sk_test_sentinel_never_leak_987654321';

  // Stub the transport adapter so Axios runs its real response interceptors
  // (including sanitizeAxiosError in src/config/paystack.js).
  paystackAPI.defaults.adapter = async (config) => {
    const err = new axios.AxiosError(
      'getaddrinfo ENOTFOUND api.paystack.co',
      'ENOTFOUND',
      {
        ...config,
        headers: {
          ...(config.headers || {}),
          Authorization: `Bearer ${fakeSecret}`,
        },
      }
    );
    throw err;
  };

  // 1. Direct check on the thrown error from paystackAPI.get
  let directErr = null;
  try {
    await paystackAPI.get('/transaction', { params: { status: 'success', page: 1 } });
  } catch (err) {
    directErr = err;
  }
  assert(directErr, 'Expected paystackAPI.get to reject with ENOTFOUND');
  assert.strictEqual(directErr.code, 'ENOTFOUND', 'Expected sanitized error to preserve code ENOTFOUND');
  assert.strictEqual(directErr.config, undefined, 'Sanitized error must not expose .config');
  assert.strictEqual(directErr.request, undefined, 'Sanitized error must not expose .request');
  assert.strictEqual(directErr.response, undefined, 'Sanitized error must not expose .response');

  const directSerialized = JSON.stringify({
    name: directErr.name,
    message: directErr.message,
    code: directErr.code,
    status: directErr.status,
    keys: Object.keys(directErr),
    stack: directErr.stack,
  });
  assertNoSecretLeak('thrown error', directSerialized);
  assert.strictEqual(directSerialized.includes(fakeSecret), false, 'thrown error leaked fake secret');

  // 2. End-to-end check through reconciliation.worker.js and real pg-boss -> pgboss.job.output
  const testQueue = `reconcile-test-${crypto.randomBytes(4).toString('hex')}`;
  const boss = new PgBoss({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    schema: 'pgboss',
  });

  let jobId = null;
  try {
    await boss.start();

    // Redirect only the 'reconcile' queue name to our isolated testQueue so we
    // execute the real reconciliation.worker.js handler without colliding with
    // any live worker.js process.
    const bossProxy = {
      createQueue: (name, opts) => boss.createQueue(name === 'reconcile' ? testQueue : name, opts),
      work: (name, opts, handler) => boss.work(name === 'reconcile' ? testQueue : name, opts, handler),
      send: (name, data, opts) => boss.send(name, data, opts),
      schedule: async () => {},
    };

    await registerReconciliationWorker(bossProxy);

    jobId = await boss.send(testQueue, {}, { retryLimit: 0 });
    assert(jobId, 'Failed to enqueue test reconcile job');

    // Wait up to 10s for pg-boss to run the worker and mark the job failed
    let row = null;
    for (let i = 0; i < 40; i++) {
      const { rows } = await pool.query(
        'SELECT id, state, output FROM pgboss.job WHERE id = $1',
        [jobId]
      );
      if (rows[0] && rows[0].state === 'failed') {
        row = rows[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    assert(row, 'Expected test reconcile job to transition to failed state in pgboss.job');
    const outputText = typeof row.output === 'string' ? row.output : JSON.stringify(row.output || {});
    assert(outputText.includes('ENOTFOUND'), `Expected ENOTFOUND in pgboss.job.output, got: ${outputText}`);
    assertNoSecretLeak('pgboss.job.output', outputText);
    assert.strictEqual(outputText.includes(fakeSecret), false, 'pgboss.job.output leaked fake secret');

    console.log('PASSED: ENOTFOUND error and pgboss.job.output are sanitized');
    console.log('Sanitized pgboss.job.output:', outputText);
  } finally {
    paystackAPI.defaults.adapter = originalAdapter;
    await boss.offWork(testQueue).catch(() => {});
    if (jobId) {
      await pool.query('DELETE FROM pgboss.job WHERE id = $1', [jobId]).catch(() => {});
    }
    await boss.deleteQueue(testQueue).catch(() => {});
    await boss.stop({ graceful: false }).catch(() => {});
    await pool.end();
  }
}

run().catch((err) => {
  console.error('TEST FAILED:', err.message);
  process.exit(1);
});

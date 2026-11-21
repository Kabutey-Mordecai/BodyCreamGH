'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const backendDir = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(backendDir, '.env') });

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function validateTestDatabaseUrl() {
  const testUrlRaw = (process.env.TEST_DATABASE_URL || '').trim();
  if (!testUrlRaw) {
    console.error('[FATAL] TEST_DATABASE_URL must be set to a local PostgreSQL test database before running npm test.');
    process.exit(1);
  }

  let parsedTest;
  try {
    parsedTest = new URL(testUrlRaw);
  } catch {
    console.error('[FATAL] TEST_DATABASE_URL is not a valid URL.');
    process.exit(1);
  }

  if (!['postgres:', 'postgresql:'].includes(parsedTest.protocol)) {
    console.error('[FATAL] TEST_DATABASE_URL must use postgres:// or postgresql://.');
    process.exit(1);
  }

  const host = (parsedTest.hostname || '').toLowerCase();
  if (!LOCAL_HOSTS.has(host)) {
    console.error(`[FATAL] Refusing to run tests against non-local host "${host}". TEST_DATABASE_URL must point to localhost / 127.0.0.1 / ::1.`);
    process.exit(1);
  }

  const prodUrlRaw = (process.env.DATABASE_URL || '').trim();
  if (prodUrlRaw && testUrlRaw === prodUrlRaw) {
    console.error('[FATAL] Refusing to run tests: TEST_DATABASE_URL must not equal DATABASE_URL.');
    process.exit(1);
  }

  const testDbName = decodeURIComponent(parsedTest.pathname.replace(/^\//, ''));
  if (!testDbName) {
    console.error('[FATAL] TEST_DATABASE_URL must include a database name.');
    process.exit(1);
  }

  const devDbName = (process.env.DB_NAME || '').trim();
  if (devDbName && testDbName === devDbName) {
    console.error(`[FATAL] Refusing to run tests: TEST_DATABASE_URL database "${testDbName}" matches DB_NAME ("${devDbName}"). Use a separate test database.`);
    process.exit(1);
  }

  return {
    connectionString: testUrlRaw,
    host: parsedTest.hostname,
    port: parsedTest.port || '5432',
    database: testDbName,
    user: decodeURIComponent(parsedTest.username || ''),
    password: decodeURIComponent(parsedTest.password || ''),
  };
}

const testDb = validateTestDatabaseUrl();

const childEnv = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: testDb.connectionString,
  DB_HOST: testDb.host,
  DB_PORT: testDb.port,
  DB_NAME: testDb.database,
  ...(testDb.user ? { DB_USER: testDb.user } : {}),
  ...(testDb.password ? { DB_PASSWORD: testDb.password } : {}),
};

const tests = [
  'scripts/test-payment-flows.js',
  'scripts/test-auth-pin-reset.js',
  'scripts/test-reconcile-error-sanitization.js',
  'scripts/test-webhook-signature.js',
  'scripts/test-order-number.js',
  'scripts/test-duplicate-payment-refund.js',
  'scripts/test-require-admin.js',
  'scripts/test-partial-returns.js',
];

for (const script of tests) {
  console.log(`\n=== Running ${script} (db: ${testDb.database}) ===`);
  const res = spawnSync(process.execPath, [script], {
    cwd: backendDir,
    env: childEnv,
    stdio: 'inherit',
  });
  if (res.status !== 0) {
    console.error(`\nFAILED: ${script} (exit code ${res.status})`);
    process.exit(res.status || 1);
  }
}

console.log(`\nALL ${tests.length} BACKEND TEST SUITES PASSED (db: ${testDb.database})`);

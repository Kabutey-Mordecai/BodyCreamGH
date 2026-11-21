'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const backendDir = path.resolve(__dirname, '..');
const tests = [
  'scripts/test-payment-flows.js',
  'scripts/test-auth-pin-reset.js',
  'scripts/test-reconcile-error-sanitization.js',
  'scripts/test-webhook-signature.js',
  'scripts/test-order-number.js',
  'scripts/test-duplicate-payment-refund.js',
];

for (const script of tests) {
  console.log(`\n=== Running ${script} ===`);
  const res = spawnSync(process.execPath, [script], {
    cwd: backendDir,
    stdio: 'inherit',
  });
  if (res.status !== 0) {
    console.error(`\nFAILED: ${script} (exit code ${res.status})`);
    process.exit(res.status || 1);
  }
}

console.log(`\nALL ${tests.length} BACKEND TEST SUITES PASSED`);

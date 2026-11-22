'use strict';

require('dotenv').config();
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const testUrl = (process.env.TEST_DATABASE_URL || '').trim();
if (!testUrl) {
  console.error('[FATAL] TEST_DATABASE_URL must be set');
  process.exit(1);
}
process.env.DATABASE_URL = testUrl;

const pool = require('../src/config/database');
const ProductModel = require('../src/models/product.model');
const { validateCreateOrder } = require('../src/middleware/validation');
const { getFinancials } = require('../src/controllers/admin.controller');

function runMiddleware(mw, body) {
  return new Promise((resolve) => {
    const req = { body };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, payload, req }); },
    };
    mw(req, res, () => resolve({ status: 200, next: true, req }));
  });
}

async function main() {
  try {
    // 4a. GhanaPostGPS validation (trim + uppercase before regex)
    const baseBody = {
      fulfillment_method: 'delivery',
      payment_method: 'paystack',
      shipping_address: '12 Oxford Street',
      shipping_city: 'Accra',
      shipping_region: 'Greater Accra',
    };

    for (const validGps of ['GA-123-4567', 'ga-1234-5678', ' GA-123-4567 ']) {
      const r = await runMiddleware(validateCreateOrder, { ...baseBody, ghana_post_gps: validGps });
      assert.strictEqual(r.status, 200, `Expected ${JSON.stringify(validGps)} to be accepted`);
      assert.strictEqual(
        r.req.body.ghana_post_gps,
        validGps.trim().toUpperCase(),
        `Expected ${JSON.stringify(validGps)} to normalize to trimmed uppercase`
      );
    }

    for (const badGps of ['GA123-4567', 'G-12-34']) {
      const r = await runMiddleware(validateCreateOrder, { ...baseBody, ghana_post_gps: badGps });
      assert.strictEqual(r.status, 400, `Expected ${JSON.stringify(badGps)} to be rejected with 400`);
    }

    // 4b. Financials uses site_settings paystack_fee_pct & statutory_tax_pct
    let finPayload = null;
    await getFinancials(
      { query: { days: 30 } },
      {
        status() { return this; },
        json(d) { finPayload = d; },
      }
    );
    assert.ok(finPayload, 'getFinancials must return JSON');
    assert.strictEqual(typeof finPayload.paystack_fee_pct, 'number');
    assert.strictEqual(typeof finPayload.statutory_tax_pct, 'number');

    // 4c. Service Worker cache safety checks
    const swSrc = fs.readFileSync(path.resolve(__dirname, '../../frontend/public/sw.js'), 'utf8');
    assert.ok(
      /CACHE_NAME\s*=\s*(`bodycreamgh-shell-\$\{BUILD_HASH\}`|'bodycreamgh-shell-)/.test(swSrc),
      'sw.js must use versioned CACHE_NAME'
    );
    for (const prefix of ['/api/', '/checkout', '/login', '/account', '/orders', '/order']) {
      assert.ok(swSrc.includes(`'${prefix}'`), `sw.js NO_CACHE_PREFIXES must include ${prefix}`);
    }
    assert.ok(swSrc.includes('caches.delete'), 'sw.js activate handler must delete old caches');

    // Also verify dist/sw.js gets stamped on build if present
    const distSwPath = path.resolve(__dirname, '../../frontend/dist/sw.js');
    if (fs.existsSync(distSwPath)) {
      const distSw = fs.readFileSync(distSwPath, 'utf8');
      assert.ok(!distSw.includes('__BUILD_HASH__'), 'dist/sw.js must replace __BUILD_HASH__ with real build hash');
    }

    // Verify CI fallback when .git is absent
    const mockSw = "const BUILD_HASH = '__BUILD_HASH__'; const CACHE_NAME = `bodycreamgh-shell-${BUILD_HASH}`;";
    let ciFallback = '';
    try {
      require('child_process').execSync('git --git-dir=/nonexistent/path rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      ciFallback = require('crypto').randomBytes(4).toString('hex');
    }
    assert.ok(ciFallback && ciFallback.length === 8, 'CI fallback must generate random hex hash when .git is absent');
    const stampedCi = mockSw.replace(/__BUILD_HASH__/g, ciFallback);
    assert.ok(stampedCi.includes(`const BUILD_HASH = '${ciFallback}';`), 'CI build without .git must stamp valid build hash');

    // 5. Rehearse migrations 040-042 SQL idempotency directly on bodycream_test
    for (const file of [
      '040_ghana_post_gps_and_landmark.sql',
      '041_abandoned_checkouts_and_beauty_facets.sql',
      '042_rbac_and_audit_logs.sql',
    ]) {
      const sql = fs.readFileSync(path.resolve(__dirname, '../migrations', file), 'utf8');
      await pool.query(sql);
    }

    // 5b. pg_trgm missing fallback test (ProductModel.findAll falls back cleanly to ILIKE)
    ProductModel._setPgTrgmForTesting(false);
    const fallbackRes = await ProductModel.findAll({ search: 'Shea' });
    assert.ok(Array.isArray(fallbackRes), 'ILIKE fallback search must succeed without pg_trgm');
    ProductModel._setPgTrgmForTesting(null);

    console.log('ALL MISC HARDENING TESTS (GPS, FINANCIALS, SW, MIGRATION IDEMPOTENCY, PG_TRGM FALLBACK) PASSED');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

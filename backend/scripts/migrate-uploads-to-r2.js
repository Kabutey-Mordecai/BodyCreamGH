'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const REQUIRED_ENV = [
  'DATABASE_URL',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  'R2_PUBLIC_BASE_URL',
];
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k] || !String(process.env[k]).trim());
if (missingEnv.length > 0) {
  console.error(
    `[migrate-uploads-to-r2] Missing required environment variable(s): ${missingEnv.join(', ')}`
  );
  process.exit(1);
}

const pool = require('../src/config/database');
const storage = require('../src/services/storage.service');

const UPLOADS_ROOT = path.join(__dirname, '..', '..', 'uploads');
const DRY_RUN = process.argv.includes('--dry-run');

function mimeForExt(ext) {
  const map = {
    '.webp': 'image/webp',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
  };
  return map[ext.toLowerCase()] || 'application/octet-stream';
}

async function migrateLocalPathToR2(localUrl) {
  if (!localUrl || typeof localUrl !== 'string' || !localUrl.startsWith('/uploads/')) {
    return { url: localUrl, migrated: false, missing: false };
  }
  const relKey = localUrl.slice('/uploads/'.length).replace(/^\/+/, '');
  const absPath = path.join(UPLOADS_ROOT, relKey);
  if (!fs.existsSync(absPath)) {
    return { url: localUrl, migrated: false, missing: true };
  }
  const newUrl = storage.getPublicUrl(relKey);
  if (!DRY_RUN) {
    const buffer = await fs.promises.readFile(absPath);
    await storage.put({
      key: relKey,
      buffer,
      contentType: mimeForExt(path.extname(absPath)),
    });
    // Originals on local disk are intentionally preserved
  }
  return { url: newUrl, migrated: true, missing: false };
}

(async () => {
  if (storage.getStorageDriver() !== 'r2') {
    console.error('Set STORAGE_DRIVER=r2 and all R2_* env vars before running migration.');
    process.exit(1);
  }

  console.log(`Starting /uploads -> R2 migration (dryRun=${DRY_RUN})...`);
  const summary = { updated: 0, missingFiles: 0 };

  // 1. Single-URL columns
  const singleTables = [
    { table: 'products', col: 'image_url' },
    { table: 'product_images', col: 'url' },
    { table: 'product_variants', col: 'image_url' },
    { table: 'deliveries', col: 'pod_photo_url' },
  ];

  for (const { table, col } of singleTables) {
    const { rows } = await pool.query(
      `SELECT id, ${col} AS val FROM ${table} WHERE ${col} LIKE '/uploads/%'`
    );
    console.log(`[${table}.${col}] found ${rows.length} /uploads/ rows`);
    for (const r of rows) {
      const res = await migrateLocalPathToR2(r.val);
      if (res.missing) {
        summary.missingFiles += 1;
        console.warn(`  MISSING local file for ${table}.${col} id=${r.id}: ${r.val}`);
        continue;
      }
      if (res.migrated) {
        summary.updated += 1;
        if (!DRY_RUN) {
          await pool.query(`UPDATE ${table} SET ${col} = $1 WHERE id = $2`, [res.url, r.id]);
        }
      }
    }
  }

  // 2. product_reviews.images (JSONB array)
  const { rows: revRows } = await pool.query(
    `SELECT id, images FROM product_reviews WHERE images::text LIKE '%/uploads/%'`
  );
  console.log(`[product_reviews.images] found ${revRows.length} rows containing /uploads/`);
  for (const r of revRows) {
    const arr = Array.isArray(r.images) ? r.images : [];
    let changed = false;
    const nextArr = [];
    for (const item of arr) {
      const res = await migrateLocalPathToR2(item);
      if (res.missing) summary.missingFiles += 1;
      if (res.migrated) {
        changed = true;
        summary.updated += 1;
      }
      nextArr.push(res.url);
    }
    if (changed && !DRY_RUN) {
      await pool.query(`UPDATE product_reviews SET images = $1::jsonb WHERE id = $2`, [
        JSON.stringify(nextArr),
        r.id,
      ]);
    }
  }

  console.log('Migration complete:', summary);
  await pool.end();
})().catch(async (err) => {
  console.error('Migration failed:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});

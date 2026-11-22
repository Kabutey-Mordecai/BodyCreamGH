// migrations/run.js
// Idempotent migration runner — tracks which files have already been applied
// in a schema_migrations table so it is safe to run multiple times (on redeploy,
// inside Docker, or after adding a new migration file).
require('dotenv').config();
const { Pool } = require('pg');
const fs   = require('fs');
const path = require('path');

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : new Pool({
      host:     process.env.DB_HOST,
      port:     process.env.DB_PORT,
      database: process.env.DB_NAME,
      user:     process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    });

async function runMigrations() {
  // Create the tracking table on first run — harmless on subsequent runs
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Find out which files have already been applied
  const { rows: applied } = await pool.query('SELECT filename FROM schema_migrations');
  const done = new Set(applied.map(r => r.filename));

  // Read all .sql files in this directory, sorted (001 → 008)
  const dir   = path.join(__dirname);
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  let ran = 0;
  for (const file of files) {
    if (done.has(file)) {
      console.log(`  skip  ${file}  (already applied)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    console.log(`  run   ${file}`);
    await pool.query(sql);

    // Record this file as applied so future runs skip it
    await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    console.log(`  done  ${file}`);
    ran++;
  }

  await pool.end();
  console.log(`\nMigrations complete. Applied: ${ran}, Skipped: ${files.length - ran}`);
}

runMigrations().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});

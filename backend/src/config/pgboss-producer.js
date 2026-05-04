'use strict';

// Producer-only pg-boss instance used exclusively by the web server process.
//
// The full pg-boss instance in pgboss.js is owned by worker.js (the separate
// worker process). That process calls boss.start() with all maintenance flags
// enabled (supervise, schedule, migrate).
//
// This instance runs in the web server process solely to enqueue jobs via
// boss.send(). Maintenance, scheduling, and migrations are all disabled so the
// web server process does no duplicate work and opens only 2 extra connections.
//
// pg-boss still requires start() to be called before send() — server.js calls
// it during startup and stop() during graceful shutdown.

const { PgBoss } = require('pg-boss');

const boss = new PgBoss({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT, 10) || 5432,
  database: process.env.DB_NAME     || 'cosmetics_db',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '',
  max:      2,          // minimal pool — only used for boss.send() calls
  supervise: false,     // expiry/archiving belongs to worker.js
  schedule:  false,     // cron scheduling belongs to worker.js
  migrate:   false,     // schema migrations belong to worker.js; this checks compat only
});

boss.on('error', err => {
  // Avoid crashing the web server on non-fatal queue errors.
  // The underlying pool error will still surface in pg-boss internals.
  const logger = require('../utils/logger');
  logger.error('pgboss-producer error', { err: err.message });
});

module.exports = boss;

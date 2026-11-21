'use strict';

// Worker process entrypoint — started by PM2 as a single fork (not cluster).
// Runs pg-boss, all queue workers, and the reconciliation schedule.
// The web server (src/server.js) does NOT start pg-boss or workers, so this
// process is the only one consuming the pg-boss connection pool.

require('dotenv').config();
require('./config/env'); // fail-fast production env validation — matches server.js

const logger = require('./utils/logger');
const pool   = require('./config/database');

async function start() {
  logger.info('pg-boss starting');

  const boss = require('./config/pgboss');

  // ── pg-boss event listeners ───────────────────────────────────────────────
  // Attached BEFORE boss.start() so errors that occur during startup
  // (e.g. failed DB connection, failed migration) are captured.

  // Errors from any internal component — worker handler failures include
  // the queue name and worker ID; infrastructure errors include only message.
  boss.on('error', err => {
    logger.error('pg-boss error', {
      message: err?.message || String(err),
      queue:   err?.queue   || undefined,
      worker:  err?.worker  || undefined,
    });
  });

  // Slow-query and large-backlog warnings from boss/timekeeper.
  boss.on('warning', warn => {
    logger.warn('pg-boss warning', {
      message: warn?.message,
      data:    warn?.data,
    });
  });

  // Emitted after boss.stop() completes its graceful drain.
  boss.on('stopped', () => {
    logger.info('pg-boss stopped');
  });

  // Internal maintenance commands (expiry, archiving).
  // Only 'failed' is actionable; 'in_progress' and 'completed' are noise.
  boss.on('bam', event => {
    if (event?.status === 'failed') {
      logger.error('pg-boss bam command failed', {
        name:  event.name,
        queue: event.queue,
        error: event.error,
      });
    }
  });

  await boss.start();
  logger.info('pg-boss started');

  await require('./workers/payment.worker')(boss);
  logger.info('Payment worker registered');

  await require('./workers/shipment.worker')(boss);
  logger.info('Shipment worker registered');

  await require('./workers/notification.worker')(boss);
  logger.info('Notification worker registered');

  await require('./workers/reconciliation.worker')(boss);
  logger.info('Payment reconciliation worker registered');

  await require('./workers/newsletter.worker')(boss);
  logger.info('Newsletter worker registered');

  await require('./workers/refund.reconciliation.worker')(boss);
  logger.info('Refund reconciliation worker registered');

  await require('./workers/order.expiry.worker')(boss);
  logger.info('Order expiry worker registered');

  logger.info('Worker process ready');

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  // boss.stop() waits for in-progress jobs to finish (up to the timeout below)
  // before releasing its connection pool. The DB pool is then drained so the
  // process exits cleanly without orphaned connections.
  async function shutdown(signal) {
    logger.info(`${signal} received — stopping workers`);
    await boss
      .stop({ graceful: true, timeout: 30_000 })
      .catch(err => logger.error('pg-boss stop error', { err: err.message }));
    await pool.end().catch(err => logger.error('DB pool close error', { err: err.message }));
    logger.info('Worker process stopped');
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

start().catch(err => {
  logger.error('Worker process failed to start', { err: err.message });
  process.exit(1);
});

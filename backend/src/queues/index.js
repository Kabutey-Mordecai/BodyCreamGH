// Thin wrappers around pg-boss so controllers keep the same .add() interface
// they had with BullMQ. Only the queue names and option shapes differ internally.
//
// Uses the producer-only pg-boss instance (pgboss-producer) which the web
// server starts during initialisation. The full instance in pgboss.js is
// reserved for worker.js so each process owns exactly one boss lifecycle.

const boss = require('../config/pgboss-producer');

// Per-queue safe defaults (pg-boss native option names).
//
// expireInSeconds: max time a worker may hold a job before pg-boss marks it
//   expired and releases it for retry — prevents a crashed worker from
//   occupying a slot indefinitely.
// retryDelay:      base retry interval in seconds; grows exponentially when
//   retryBackoff is true.
const PAYMENT_DEFAULTS = {
  retryLimit:      5,
  retryDelay:      30,
  retryBackoff:    true,
  expireInSeconds: 300,   // 5 min — payment handlers should finish well within this
};

const SHIPMENT_DEFAULTS = {
  retryLimit:      3,
  retryDelay:      30,
  retryBackoff:    true,
  expireInSeconds: 120,   // 2 min
};

const NOTIFICATION_DEFAULTS = {
  retryLimit:      3,
  retryDelay:      60,
  retryBackoff:    true,
  expireInSeconds: 120,   // 2 min — SMTP should recover quickly or not at all
};

const RECONCILE_DEFAULTS = {
  retryLimit:      1,
  retryDelay:      120,
  retryBackoff:    false,
  expireInSeconds: 540,   // 9 min — just under the 10-min schedule cadence to avoid overlap
};

const NEWSLETTER_DEFAULTS = {
  retryLimit:      1,
  retryDelay:      60,
  retryBackoff:    false,
  expireInSeconds: 3600,  // 1 hr — bulk send jobs can take time
};

// Translate BullMQ-style caller options to pg-boss options, then spread over
// queue defaults. Caller-provided values always win.
function pgOpts(defaults, opts = {}) {
  const translated = {};
  if (opts.attempts  !== undefined) translated.retryLimit   = opts.attempts;
  if (opts.delay)                   translated.startAfter   = Math.ceil(opts.delay / 1000);
  if (opts.singletonKey !== undefined) translated.singletonKey = opts.singletonKey;
  return { ...defaults, ...translated };
}

const paymentQueue = {
  add: (name, data, opts) => boss.send(`payment/${name}`, data, pgOpts(PAYMENT_DEFAULTS, opts)),
};

const shipmentQueue = {
  add: (name, data, opts) => boss.send(`shipment/${name}`, data, pgOpts(SHIPMENT_DEFAULTS, opts)),
};

const notificationQueue = {
  add: (name, data, opts) => boss.send(`notification/${name}`, data, pgOpts(NOTIFICATION_DEFAULTS, opts)),
};

const reconcileQueue = {
  add: (_name, data, opts) => boss.send('reconcile', data, pgOpts(RECONCILE_DEFAULTS, opts)),
};

const newsletterQueue = {
  add: (name, data, opts) => boss.send(`newsletter/${name}`, data, pgOpts(NEWSLETTER_DEFAULTS, opts)),
};

module.exports = { paymentQueue, shipmentQueue, notificationQueue, reconcileQueue, newsletterQueue };

// Thin wrappers around pg-boss so controllers keep the same .add() interface
// they had with BullMQ. Only the queue names and option shapes differ internally.

const boss = require('../config/pgboss');

function pgOpts(opts = {}) {
  return {
    retryLimit:   opts.attempts  || 3,
    retryDelay:   5,
    retryBackoff: true,
    // BullMQ delay is ms → pg-boss startAfter is seconds
    ...(opts.delay ? { startAfter: Math.ceil(opts.delay / 1000) } : {}),
  };
}

const paymentQueue = {
  add: (name, data, opts) => boss.send(`payment/${name}`, data, pgOpts(opts)),
};

const shipmentQueue = {
  add: (name, data, opts) => boss.send(`shipment/${name}`, data, pgOpts(opts)),
};

const notificationQueue = {
  add: (name, data, opts) => boss.send(`notification/${name}`, data, pgOpts(opts)),
};

const reconcileQueue = {
  add: (_name, data, opts) => boss.send('reconcile', data, pgOpts(opts)),
};

module.exports = { paymentQueue, shipmentQueue, notificationQueue, reconcileQueue };

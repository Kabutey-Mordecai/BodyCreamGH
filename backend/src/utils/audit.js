const { v4: uuid } = require('uuid');
const pool         = require('../config/database');
const logger       = require('./logger');

async function logStatusChange(orderId, fromStatus, toStatus, note = null) {
  await pool.query(
    `INSERT INTO order_status_log (id, order_id, from_status, to_status, note)
     VALUES ($1, $2, $3, $4, $5)`,
    [uuid(), orderId, fromStatus, toStatus, note]
  ).catch(err => logger.error('logStatusChange error', { err: err.message, orderId }));
}

module.exports = { logStatusChange };

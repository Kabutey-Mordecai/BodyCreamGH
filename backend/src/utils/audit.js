const { randomUUID: uuid } = require('crypto');
const pool         = require('../config/database');
const logger       = require('./logger');

async function logStatusChange(orderId, fromStatus, toStatus, note = null, client = pool) {
  await client.query(
    `INSERT INTO order_status_log (id, order_id, from_status, to_status, note)
     VALUES ($1, $2, $3, $4, $5)`,
    [uuid(), orderId, fromStatus, toStatus, note]
  ).catch(err => {
    logger.error('logStatusChange error', { err: err.message, orderId });
    if (client !== pool) throw err;
  });
}

async function logAdminAction({
  actorId = null,
  actorEmail = null,
  action,
  resourceType,
  resourceId = null,
  details = {},
  ip = null,
} = {}) {
  try {
    await pool.query(
      `INSERT INTO admin_audit_logs
         (id, actor_id, actor_email, action, resource_type, resource_id, details_json, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
      [
        uuid(),
        actorId,
        actorEmail,
        action,
        resourceType,
        resourceId ? String(resourceId) : null,
        JSON.stringify(details || {}),
        ip,
      ]
    );
  } catch (err) {
    logger.error('logAdminAction error', { err: err.message, action, resourceType });
  }
}

module.exports = { logStatusChange, logAdminAction };

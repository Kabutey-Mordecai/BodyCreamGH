const pool = require('../config/database');

async function isProcessed(eventId) {
  const { rows } = await pool.query(
    'SELECT 1 FROM processed_events WHERE event_id = $1',
    [eventId]
  );
  return rows.length > 0;
}

// Pass a pg client when inside a transaction so the insert is atomic with the surrounding work.
// Falls back to the shared pool when called outside a transaction.
async function markProcessed(eventId, eventType, client = pool) {
  await client.query(
    'INSERT INTO processed_events (event_id, event_type) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [eventId, eventType]
  );
}

module.exports = { isProcessed, markProcessed };

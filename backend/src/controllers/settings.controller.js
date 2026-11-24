const NodeCache = require('node-cache');
const pool = require('../config/database');
const logger = require('../utils/logger');

const settingsCache = new NodeCache({ stdTTL: 120, checkperiod: 60, maxKeys: 10 });
const SETTINGS_CACHE_KEY = 'site_settings:all';

function parsePartialReturnsFlag(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
  }
  return process.env.PARTIAL_RETURNS_ENABLED === 'true';
}

async function isPartialReturnsEnabled() {
  const cached = settingsCache.get(SETTINGS_CACHE_KEY);
  if (cached) {
    return parsePartialReturnsFlag(cached.partial_returns_enabled);
  }
  try {
    const { rows } = await pool.query(
      "SELECT value FROM site_settings WHERE key = 'partial_returns_enabled'"
    );
    if (rows.length > 0) {
      return parsePartialReturnsFlag(rows[0].value);
    }
  } catch (err) {
    logger.warn('Failed to read partial_returns_enabled from site_settings', { err: err.message });
  }
  return process.env.PARTIAL_RETURNS_ENABLED === 'true';
}

// Public read — the storefront fetches all settings on page load so it can
// render hero text, theme colors, etc. without round-trips per key.
const getAllSettings = async (req, res) => {
  try {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    const cached = settingsCache.get(SETTINGS_CACHE_KEY);
    if (cached) {
      return res.json({
        ...cached,
        partial_returns_enabled: parsePartialReturnsFlag(cached.partial_returns_enabled),
      });
    }

    const { rows } = await pool.query('SELECT key, value FROM site_settings');
    // Flatten rows into { key: value } so the client doesn't have to reduce it itself.
    const out = {};
    for (const r of rows) out[r.key] = r.value;
    settingsCache.set(SETTINGS_CACHE_KEY, out);
    res.json({
      ...out,
      partial_returns_enabled: parsePartialReturnsFlag(out.partial_returns_enabled),
    });
  } catch (err) {
    logger.error('Settings read error', { err: err.message });
    res.status(500).json({ error: 'Failed to load settings' });
  }
};

// Admin write — upsert a single key.
const upsertSetting = async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key || typeof key !== 'string') return res.status(400).json({ error: 'key must be a non-empty string' });
    if (key.length > 100) return res.status(400).json({ error: 'key too long (max 100 characters)' });
    if (value === undefined) return res.status(400).json({ error: 'value is required' });

    await pool.query(
      `INSERT INTO site_settings (key, value, updated_by, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
      [key, JSON.stringify(value), req.user?.id || null]
    );
    settingsCache.flushAll();
    const { logAdminAction } = require('../utils/audit');
    const isSensitive = /secret|token|password|key/i.test(key);
    await logAdminAction({
      actorId: req.user?.id,
      actorEmail: req.userEmail,
      action: 'settings.update',
      resourceType: 'site_settings',
      resourceId: key,
      details: { key, value: isSensitive ? '[REDACTED]' : value },
      ip: req.ip,
    });
    res.json({ ok: true });
  } catch (err) {
    logger.error('Settings upsert error', { err: err.message });
    res.status(500).json({ error: 'Failed to save setting' });
  }
};

// Admin bulk write — used by the Storefront Editor / Theme Customizer when
// the user hits "Publish". One transaction so the site never ends up in a
// half-updated state.
const upsertManySettings = async (req, res) => {
  const { entries } = req.body;
  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: 'entries must be a non-empty array' });
  }
  if (entries.length > 200) {
    return res.status(400).json({ error: 'Too many entries (max 200 per request)' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const { key, value } of entries) {
      if (!key || typeof key !== 'string' || key.length > 100) continue;
      await client.query(
        `INSERT INTO site_settings (key, value, updated_by, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()`,
        [key, JSON.stringify(value), req.user?.id || null]
      );
    }
    await client.query('COMMIT');
    settingsCache.flushAll();
    const { logAdminAction } = require('../utils/audit');
    await logAdminAction({
      actorId: req.user?.id,
      actorEmail: req.userEmail,
      action: 'settings.bulk_update',
      resourceType: 'site_settings',
      details: {
        keys: entries
          .map(e => e?.key)
          .filter(Boolean)
          .filter(k => !/secret|token|password|key/i.test(k))
          .slice(0, 50),
      },
      ip: req.ip,
    });
    res.json({ ok: true, count: entries.length });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Settings bulk upsert error', { err: err.message });
    res.status(500).json({ error: 'Failed to save settings' });
  } finally {
    client.release();
  }
};

module.exports = { getAllSettings, upsertSetting, upsertManySettings, isPartialReturnsEnabled };

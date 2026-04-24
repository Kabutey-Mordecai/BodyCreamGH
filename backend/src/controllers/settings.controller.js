const pool = require('../config/database');

// Public read — the storefront fetches all settings on page load so it can
// render hero text, theme colors, etc. without round-trips per key.
const getAllSettings = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT key, value FROM site_settings');
    // Flatten rows into { key: value } so the client doesn't have to reduce it itself.
    const out = {};
    for (const r of rows) out[r.key] = r.value;
    res.json(out);
  } catch (err) {
    console.error('Settings read error:', err);
    res.status(500).json({ error: 'Failed to load settings' });
  }
};

// Admin write — upsert a single key.
const upsertSetting = async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: 'key is required' });

    await pool.query(
      `INSERT INTO site_settings (key, value, updated_by, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
      [key, JSON.stringify(value), req.user?.id || null]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Settings upsert error:', err);
    res.status(500).json({ error: 'Failed to save setting' });
  }
};

// Admin bulk write — used by the Storefront Editor / Theme Customizer when
// the user hits "Publish". One transaction so the site never ends up in a
// half-updated state.
const upsertManySettings = async (req, res) => {
  const { entries } = req.body;
  if (!Array.isArray(entries)) {
    return res.status(400).json({ error: 'entries must be an array' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const { key, value } of entries) {
      if (!key) continue;
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
    res.json({ ok: true, count: entries.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Settings bulk upsert error:', err);
    res.status(500).json({ error: 'Failed to save settings' });
  } finally {
    client.release();
  }
};

module.exports = { getAllSettings, upsertSetting, upsertManySettings };

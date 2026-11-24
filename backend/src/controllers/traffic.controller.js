'use strict';

const crypto = require('crypto');
const pool = require('../config/database');
const logger = require('../utils/logger');

let tableEnsured = false;

async function ensureTrafficTable() {
  if (tableEnsured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_visits (
      id BIGSERIAL PRIMARY KEY,
      visitor_id VARCHAR(64) NOT NULL,
      path VARCHAR(255) NOT NULL,
      referrer VARCHAR(255) DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_site_visits_created_at ON site_visits (created_at);
    CREATE INDEX IF NOT EXISTS idx_site_visits_visitor_created ON site_visits (visitor_id, created_at);
  `);
  tableEnsured = true;
}

const BOT_UA_RE = /bot|crawler|spider|slurp|headless|lighthouse|pingdom|uptimerobot|curl|wget|python-requests/i;

const recordVisit = async (req, res) => {
  try {
    const ua = String(req.headers['user-agent'] || '');
    if (BOT_UA_RE.test(ua)) {
      return res.status(204).end();
    }

    await ensureTrafficTable();

    const rawPath = typeof req.body?.path === 'string' ? req.body.path.trim() : '/';
    const path = (rawPath.startsWith('/') ? rawPath : `/${rawPath}`).split('?')[0].slice(0, 255) || '/';

    let visitorId = typeof req.body?.visitor_id === 'string'
      ? req.body.visitor_id.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
      : '';
    if (!visitorId) {
      const day = new Date().toISOString().slice(0, 10);
      visitorId = crypto.createHash('sha256').update(`${req.ip}|${ua}|${day}`).digest('hex').slice(0, 32);
    }

    const referrer = typeof req.body?.referrer === 'string'
      ? req.body.referrer.trim().slice(0, 255)
      : '';

    await pool.query(
      `INSERT INTO site_visits (visitor_id, path, referrer) VALUES ($1, $2, $3)`,
      [visitorId, path, referrer]
    );

    return res.status(204).end();
  } catch (err) {
    logger.warn('recordVisit failed', { err: err.message });
    return res.status(204).end();
  }
};

const getTrafficAnalytics = async (req, res) => {
  try {
    await ensureTrafficTable();
    const { from, to, days } = req.query;
    let whereClause;
    let params;

    if (from && to) {
      whereClause = 'WHERE DATE(created_at) BETWEEN $1::date AND $2::date';
      params = [from, to];
    } else {
      const d = Math.min(365, Math.max(1, parseInt(days, 10) || 30));
      whereClause = "WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')";
      params = [d];
    }

    const [summaryRes, todayRes, dailyRes, topPagesRes] = await Promise.all([
      pool.query(
        `SELECT COUNT(DISTINCT visitor_id)::int AS unique_visitors,
                COUNT(*)::int AS page_views
           FROM site_visits
           ${whereClause}`,
        params
      ),
      pool.query(
        `SELECT COUNT(DISTINCT visitor_id)::int AS today_visitors,
                COUNT(*)::int AS today_page_views
           FROM site_visits
          WHERE DATE(created_at) = CURRENT_DATE`
      ),
      pool.query(
        `SELECT DATE(created_at) AS date,
                COUNT(DISTINCT visitor_id)::int AS visitors,
                COUNT(*)::int AS page_views
           FROM site_visits
           ${whereClause}
          GROUP BY DATE(created_at)
          ORDER BY date ASC`,
        params
      ),
      pool.query(
        `SELECT path,
                COUNT(*)::int AS views,
                COUNT(DISTINCT visitor_id)::int AS visitors
           FROM site_visits
           ${whereClause}
          GROUP BY path
          ORDER BY views DESC
          LIMIT 10`,
        params
      ),
    ]);

    res.json({
      unique_visitors: summaryRes.rows[0]?.unique_visitors || 0,
      page_views: summaryRes.rows[0]?.page_views || 0,
      today_visitors: todayRes.rows[0]?.today_visitors || 0,
      today_page_views: todayRes.rows[0]?.today_page_views || 0,
      daily: dailyRes.rows,
      top_pages: topPagesRes.rows,
    });
  } catch (err) {
    logger.error('getTrafficAnalytics error', { err: err.message });
    res.status(500).json({ error: 'Failed to fetch traffic analytics' });
  }
};

module.exports = {
  recordVisit,
  getTrafficAnalytics,
};

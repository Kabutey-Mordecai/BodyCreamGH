'use strict';

const { randomUUID: uuid } = require('crypto');
const pool         = require('../config/database');
const emailService = require('../services/email.service');
const logger       = require('../utils/logger');

// ── Shared segment helpers ────────────────────────────────────────────────────

async function resolveRecipientCount(segment) {
  if (segment === 'all' || segment === 'subscribers_only') {
    const { rows } = await pool.query(
      `SELECT COUNT(*) FROM newsletter_subscribers WHERE status = 'active'`
    );
    return parseInt(rows[0].count, 10);
  }
  if (segment === 'customers_only') {
    const { rows } = await pool.query(
      `SELECT COUNT(DISTINCT u.id) FROM users u
       JOIN orders o ON o.customer_id = u.id
       WHERE u.role = 'customer' AND o.payment_status = 'paid' AND u.email IS NOT NULL`
    );
    return parseInt(rows[0].count, 10);
  }
  if (segment === 'all_customers') {
    const { rows } = await pool.query(
      `SELECT COUNT(*) FROM users WHERE role = 'customer' AND email IS NOT NULL`
    );
    return parseInt(rows[0].count, 10);
  }
  return 0;
}

// ── Public: subscribe ─────────────────────────────────────────────────────────

const subscribe = async (req, res) => {
  const { email, name } = req.body;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }

  try {
    const { rows: existing } = await pool.query(
      `SELECT id, status, unsubscribe_token FROM newsletter_subscribers WHERE email = $1`,
      [email.toLowerCase().trim()]
    );

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    if (existing.length > 0) {
      const sub = existing[0];
      if (sub.status === 'active') {
        // Already active — return success silently (no duplicate welcome email)
        return res.json({ success: true, message: 'Subscribed successfully' });
      }
      // Previously unsubscribed — re-activate
      await pool.query(
        `UPDATE newsletter_subscribers
         SET status = 'active', unsubscribed_at = NULL, subscribed_at = NOW()
         WHERE id = $1`,
        [sub.id]
      );
      const unsubscribeUrl = `${frontendUrl}/unsubscribe?token=${sub.unsubscribe_token}`;
      emailService.sendNewsletterWelcome(email, { name, unsubscribeUrl }).catch(() => {});
      return res.json({ success: true, message: 'Subscribed successfully' });
    }

    // New subscriber
    const token = uuid();
    await pool.query(
      `INSERT INTO newsletter_subscribers (email, name, unsubscribe_token, source)
       VALUES ($1, $2, $3, 'storefront')`,
      [email.toLowerCase().trim(), name || null, token]
    );

    const unsubscribeUrl = `${frontendUrl}/unsubscribe?token=${token}`;
    emailService.sendNewsletterWelcome(email, { name, unsubscribeUrl }).catch(() => {});

    res.status(201).json({ success: true, message: 'Subscribed successfully' });
  } catch (err) {
    logger.error('Newsletter subscribe error', { err: err.message });
    res.status(500).json({ error: 'Subscription failed. Please try again.' });
  }
};

// ── Public: unsubscribe ───────────────────────────────────────────────────────

const unsubscribe = async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ error: 'Unsubscribe token is required.' });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE newsletter_subscribers
       SET status = 'unsubscribed', unsubscribed_at = NOW()
       WHERE unsubscribe_token = $1 AND status = 'active'
       RETURNING id`,
      [token]
    );

    if (rows.length === 0) {
      // Either invalid token, or already unsubscribed — return success either way
      return res.json({ success: true });
    }

    res.json({ success: true });
  } catch (err) {
    logger.error('Newsletter unsubscribe error', { err: err.message });
    res.status(500).json({ error: 'Unsubscribe failed. Please try again.' });
  }
};

// ── Admin: subscriber management ─────────────────────────────────────────────

const getSubscribers = async (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page  || '1', 10));
  const limit  = Math.min(100, parseInt(req.query.limit || '20', 10));
  const offset = (page - 1) * limit;
  const status = req.query.status || '';
  const search = req.query.search || '';

  const conditions = [];
  const params     = [];
  let   p          = 1;

  if (status === 'active' || status === 'unsubscribed') {
    conditions.push(`status = $${p++}`);
    params.push(status);
  }
  if (search) {
    conditions.push(`email ILIKE $${p++}`);
    params.push(`%${search}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const [listRes, countRes, statsRes] = await Promise.all([
      pool.query(
        `SELECT id, email, name, status, source, subscribed_at, unsubscribed_at
         FROM newsletter_subscribers
         ${where}
         ORDER BY subscribed_at DESC
         LIMIT $${p} OFFSET $${p + 1}`,
        [...params, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*) FROM newsletter_subscribers ${where}`,
        params
      ),
      pool.query(
        `SELECT
           COUNT(*)                                    AS total,
           COUNT(*) FILTER (WHERE status = 'active')  AS active,
           COUNT(*) FILTER (WHERE status = 'unsubscribed') AS unsubscribed
         FROM newsletter_subscribers`
      ),
    ]);

    const total      = parseInt(countRes.rows[0].count, 10);
    const totalPages = Math.ceil(total / limit);
    const stats      = {
      total:        parseInt(statsRes.rows[0].total, 10),
      active:       parseInt(statsRes.rows[0].active, 10),
      unsubscribed: parseInt(statsRes.rows[0].unsubscribed, 10),
    };

    res.json({ data: listRes.rows, total, page, limit, totalPages, stats });
  } catch (err) {
    logger.error('Get subscribers error', { err: err.message });
    res.status(500).json({ error: 'Failed to fetch subscribers.' });
  }
};

const deleteSubscriber = async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM newsletter_subscribers WHERE id = $1`,
      [id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Subscriber not found.' });
    res.json({ success: true });
  } catch (err) {
    logger.error('Delete subscriber error', { err: err.message });
    res.status(500).json({ error: 'Delete failed.' });
  }
};

const importSubscribers = async (req, res) => {
  const { emails } = req.body;
  if (!Array.isArray(emails) || emails.length === 0) {
    return res.status(400).json({ error: 'emails must be a non-empty array.' });
  }

  const valid = emails
    .map(e => String(e).toLowerCase().trim())
    .filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

  if (valid.length === 0) {
    return res.status(400).json({ error: 'No valid email addresses found.' });
  }

  let imported = 0;
  let skipped  = 0;

  for (const email of valid) {
    try {
      const { rows } = await pool.query(
        `INSERT INTO newsletter_subscribers (email, unsubscribe_token, source)
         VALUES ($1, $2, 'admin')
         ON CONFLICT (email) DO NOTHING
         RETURNING id`,
        [email, uuid()]
      );
      if (rows.length > 0) imported++;
      else skipped++;
    } catch {
      skipped++;
    }
  }

  res.json({ imported, skipped });
};

// ── Admin: campaign management ────────────────────────────────────────────────

const getPreviewCount = async (req, res) => {
  const { segment = 'all' } = req.query;
  try {
    const count = await resolveRecipientCount(segment);
    res.json({ count });
  } catch (err) {
    logger.error('Preview count error', { err: err.message });
    res.status(500).json({ error: 'Failed to calculate recipient count.' });
  }
};

const createCampaign = async (req, res) => {
  const { subject, body_html, body_text, segment = 'all' } = req.body;

  if (!subject?.trim()) return res.status(400).json({ error: 'Subject is required.' });
  if (!body_html?.trim()) return res.status(400).json({ error: 'Email body is required.' });

  const validSegments = ['all', 'subscribers_only', 'customers_only', 'all_customers'];
  if (!validSegments.includes(segment)) {
    return res.status(400).json({ error: 'Invalid segment.' });
  }

  try {
    const recipientCount = await resolveRecipientCount(segment);
    const { rows } = await pool.query(
      `INSERT INTO newsletter_campaigns
         (subject, body_html, body_text, segment, recipient_count, sent_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [subject.trim(), body_html, body_text || null, segment, recipientCount, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    logger.error('Create campaign error', { err: err.message });
    res.status(500).json({ error: 'Failed to create campaign.' });
  }
};

const sendCampaign = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT id, status, recipient_count FROM newsletter_campaigns WHERE id = $1`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Campaign not found.' });
    if (rows[0].status !== 'draft') {
      return res.status(400).json({ error: `Campaign is already ${rows[0].status}.` });
    }

    await pool.query(
      `UPDATE newsletter_campaigns SET status = 'sending', started_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [id]
    );

    const { newsletterQueue } = require('../queues');
    await newsletterQueue.add('send-campaign', { campaign_id: id });

    res.json({ queued: true });
  } catch (err) {
    // Roll back status to draft if enqueueing fails
    await pool.query(
      `UPDATE newsletter_campaigns SET status = 'draft', started_at = NULL, updated_at = NOW() WHERE id = $1`,
      [id]
    ).catch(() => {});
    logger.error('Send campaign error', { err: err.message });
    res.status(500).json({ error: 'Failed to queue campaign.' });
  }
};

const getCampaignStatus = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT status, recipient_count, sent_count, failed_count, started_at, completed_at
       FROM newsletter_campaigns WHERE id = $1`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Campaign not found.' });
    res.json(rows[0]);
  } catch (err) {
    logger.error('Campaign status error', { err: err.message });
    res.status(500).json({ error: 'Failed to fetch campaign status.' });
  }
};

const getCampaigns = async (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page  || '1', 10));
  const limit  = Math.min(100, parseInt(req.query.limit || '20', 10));
  const offset = (page - 1) * limit;

  try {
    const [listRes, countRes] = await Promise.all([
      pool.query(
        `SELECT c.id, c.subject, c.segment, c.status,
                c.recipient_count, c.sent_count, c.failed_count,
                c.created_at, c.completed_at,
                u.first_name || ' ' || u.last_name AS sent_by_name
         FROM newsletter_campaigns c
         LEFT JOIN users u ON u.id = c.sent_by
         ORDER BY c.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      pool.query(`SELECT COUNT(*) FROM newsletter_campaigns`),
    ]);

    const total      = parseInt(countRes.rows[0].count, 10);
    const totalPages = Math.ceil(total / limit);

    res.json({ data: listRes.rows, total, page, limit, totalPages });
  } catch (err) {
    logger.error('Get campaigns error', { err: err.message });
    res.status(500).json({ error: 'Failed to fetch campaigns.' });
  }
};

const getCampaignById = async (req, res) => {
  const { id } = req.params;
  try {
    const [campaignRes, sendsRes] = await Promise.all([
      pool.query(
        `SELECT c.*, u.first_name || ' ' || u.last_name AS sent_by_name
         FROM newsletter_campaigns c
         LEFT JOIN users u ON u.id = c.sent_by
         WHERE c.id = $1`,
        [id]
      ),
      pool.query(
        `SELECT id, email, status, error_message, sent_at
         FROM newsletter_sends
         WHERE campaign_id = $1
         ORDER BY created_at
         LIMIT 50`,
        [id]
      ),
    ]);

    if (campaignRes.rows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found.' });
    }

    res.json({ ...campaignRes.rows[0], sends: sendsRes.rows });
  } catch (err) {
    logger.error('Get campaign by id error', { err: err.message });
    res.status(500).json({ error: 'Failed to fetch campaign.' });
  }
};

module.exports = {
  subscribe, unsubscribe,
  getSubscribers, deleteSubscriber, importSubscribers,
  getPreviewCount, createCampaign, sendCampaign,
  getCampaignStatus, getCampaigns, getCampaignById,
};

'use strict';

const pool         = require('../config/database');
const emailService = require('../services/email.service');
const logger       = require('../utils/logger');

// Fetch all active newsletter subscriber tokens for a list of emails in one query.
async function buildTokenMap(emails) {
  if (emails.length === 0) return new Map();
  const { rows } = await pool.query(
    `SELECT email, unsubscribe_token
     FROM newsletter_subscribers
     WHERE email = ANY($1::text[]) AND status = 'active'`,
    [emails]
  );
  return new Map(rows.map(r => [r.email, r.unsubscribe_token]));
}

// Resolve the recipient list based on campaign segment.
async function resolveRecipients(segment) {
  if (segment === 'all') {
    const { rows } = await pool.query(
      `SELECT email FROM newsletter_subscribers WHERE status = 'active'`
    );
    return rows;
  }
  if (segment === 'subscribers_only') {
    const { rows } = await pool.query(
      `SELECT ns.email FROM newsletter_subscribers ns
       WHERE ns.status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM users u
           WHERE LOWER(u.email) = LOWER(ns.email) AND u.role = 'customer'
         )`
    );
    return rows;
  }
  if (segment === 'customers_only') {
    const { rows } = await pool.query(
      `SELECT DISTINCT u.email
       FROM users u
       JOIN orders o ON o.customer_id = u.id
       WHERE u.role = 'customer'
         AND o.payment_status = 'paid'
         AND u.email IS NOT NULL`
    );
    return rows;
  }
  if (segment === 'all_customers') {
    const { rows } = await pool.query(
      `SELECT email FROM users WHERE role = 'customer' AND email IS NOT NULL`
    );
    return rows;
  }
  return [];
}

module.exports = async function register(boss) {
  await boss.createQueue('newsletter/send-campaign');

  await boss.work('newsletter/send-campaign', { teamSize: 1 }, async (jobs) => {
    const job = Array.isArray(jobs) ? jobs[0] : jobs;
    if (!job?.data) return;
    const { campaign_id } = job.data;

    const { rows: campaignRows } = await pool.query(
      `SELECT * FROM newsletter_campaigns WHERE id = $1`,
      [campaign_id]
    );
    if (campaignRows.length === 0) {
      logger.warn('Newsletter campaign not found', { campaign_id });
      return;
    }
    const campaign = campaignRows[0];
    if (campaign.status !== 'sending') {
      logger.warn('Newsletter campaign not in sending state', { campaign_id, status: campaign.status });
      return;
    }

    const recipients = await resolveRecipients(campaign.segment);
    logger.info('Newsletter send started', { campaign_id, recipients: recipients.length });

    if (recipients.length === 0) {
      await pool.query(
        `UPDATE newsletter_campaigns SET status = 'sent', completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [campaign_id]
      );
      return;
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const storeName   = process.env.STORE_NAME || 'BodyCreamGH';

    // Fetch unsubscribe tokens for all recipients in one round-trip
    const emails   = recipients.map(r => r.email);
    const tokenMap = await buildTokenMap(emails);

    const BATCH_SIZE  = 10;
    const BATCH_DELAY = 200; // ms

    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const batch = recipients.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(async (recipient) => {
          // Insert a pending send record so partial progress is visible
          const { rows: sendRows } = await pool.query(
            `INSERT INTO newsletter_sends (campaign_id, email, status)
             VALUES ($1, $2, 'pending')
             RETURNING id`,
            [campaign_id, recipient.email]
          );
          const sendId = sendRows[0].id;

          const token          = tokenMap.get(recipient.email);
          const unsubscribeUrl = token
            ? `${frontendUrl}/unsubscribe?token=${token}`
            : null;

          try {
            await emailService.sendNewsletterEmail(recipient.email, {
              subject:        campaign.subject,
              bodyHtml:       campaign.body_html,
              bodyText:       campaign.body_text,
              unsubscribeUrl,
              storeName,
            });
            await pool.query(
              `UPDATE newsletter_sends SET status = 'sent', sent_at = NOW() WHERE id = $1`,
              [sendId]
            );
            return 'sent';
          } catch (err) {
            await pool.query(
              `UPDATE newsletter_sends SET status = 'failed', error_message = $1 WHERE id = $2`,
              [err.message?.slice(0, 500), sendId]
            );
            logger.warn('Newsletter send failed for recipient', { campaign_id, email: recipient.email, err: err.message });
            return 'failed';
          }
        })
      );

      const batchSent   = results.filter(r => r.status === 'fulfilled' && r.value === 'sent').length;
      const batchFailed = results.filter(r => r.status !== 'fulfilled' || r.value === 'failed').length;

      await pool.query(
        `UPDATE newsletter_campaigns
         SET sent_count   = sent_count   + $1,
             failed_count = failed_count + $2,
             updated_at   = NOW()
         WHERE id = $3`,
        [batchSent, batchFailed, campaign_id]
      );

      if (i + BATCH_SIZE < recipients.length) {
        await new Promise(r => setTimeout(r, BATCH_DELAY));
      }
    }

    await pool.query(
      `UPDATE newsletter_campaigns
       SET status = 'sent', completed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [campaign_id]
    );

    logger.info('Newsletter campaign completed', { campaign_id });
  });

  logger.info('Newsletter worker registered');
};

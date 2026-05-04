BEGIN;

CREATE TABLE newsletter_subscribers (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email             VARCHAR     NOT NULL UNIQUE,
  name              VARCHAR,
  status            VARCHAR     NOT NULL DEFAULT 'active',
  source            VARCHAR     NOT NULL DEFAULT 'storefront',
  unsubscribe_token VARCHAR     NOT NULL UNIQUE,
  subscribed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unsubscribed_at   TIMESTAMPTZ
);

CREATE TABLE newsletter_campaigns (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  subject          VARCHAR     NOT NULL,
  body_html        TEXT        NOT NULL,
  body_text        TEXT,
  segment          VARCHAR     NOT NULL DEFAULT 'all',
  status           VARCHAR     NOT NULL DEFAULT 'draft',
  recipient_count  INTEGER     NOT NULL DEFAULT 0,
  sent_count       INTEGER     NOT NULL DEFAULT 0,
  failed_count     INTEGER     NOT NULL DEFAULT 0,
  sent_by          UUID        REFERENCES users(id),
  scheduled_at     TIMESTAMPTZ,
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE newsletter_sends (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    UUID        NOT NULL REFERENCES newsletter_campaigns(id) ON DELETE CASCADE,
  email          VARCHAR     NOT NULL,
  status         VARCHAR     NOT NULL DEFAULT 'pending',
  error_message  TEXT,
  sent_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_newsletter_subscribers_email  ON newsletter_subscribers(email);
CREATE INDEX idx_newsletter_subscribers_status ON newsletter_subscribers(status);
CREATE INDEX idx_newsletter_subscribers_token  ON newsletter_subscribers(unsubscribe_token);
CREATE INDEX idx_newsletter_campaigns_status   ON newsletter_campaigns(status);
CREATE INDEX idx_newsletter_campaigns_created  ON newsletter_campaigns(created_at);
CREATE INDEX idx_newsletter_sends_campaign_id  ON newsletter_sends(campaign_id);
CREATE INDEX idx_newsletter_sends_status       ON newsletter_sends(status);

COMMIT;

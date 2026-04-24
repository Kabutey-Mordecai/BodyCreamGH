-- Key/value store for everything the Admin can customize from the UI:
-- hero banner copy, testimonials, theme colors, delivery fees, etc.
-- `value` is JSON so a single table can hold strings, numbers, booleans,
-- and arrays of objects (e.g. testimonials, categories) without schema changes.
CREATE TABLE IF NOT EXISTS site_settings (
  key         VARCHAR(100) PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_by  UUID REFERENCES users(id),
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_site_settings_updated ON site_settings(updated_at DESC);

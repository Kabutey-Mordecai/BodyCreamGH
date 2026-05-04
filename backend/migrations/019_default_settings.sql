BEGIN;

-- Seed default values for operational settings that are configurable from
-- the admin Settings page. ON CONFLICT DO NOTHING so existing customised
-- values are never overwritten by a re-run of migrations.
INSERT INTO site_settings (key, value) VALUES
  ('low_stock_threshold',          '5'),
  ('delivery_estimate_accra',      '"1–2 business days"'),
  ('delivery_estimate_nationwide', '"3–5 business days"')
ON CONFLICT (key) DO NOTHING;

COMMIT;

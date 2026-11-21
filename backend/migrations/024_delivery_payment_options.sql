-- Add fulfillment_method and payment_method to orders for Pickup Station & Pay on Delivery
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS fulfillment_method VARCHAR(20) NOT NULL DEFAULT 'delivery',
  ADD COLUMN IF NOT EXISTS payment_method     VARCHAR(30) NOT NULL DEFAULT 'paystack';

-- Seed store settings for Pickup Station and Pay on Delivery (idempotent)
INSERT INTO site_settings (key, value) VALUES
  ('pay_on_delivery_enabled',    'false'::jsonb),
  ('pay_on_delivery_accra_only', 'true'::jsonb),
  ('pickup_enabled',             'true'::jsonb),
  ('pickup_location',            '"East Legon, Accra (Call upon arrival)"'::jsonb),
  ('pickup_hours',               '"Mon–Sat, 9:00 AM – 6:00 PM"'::jsonb)
ON CONFLICT (key) DO NOTHING;

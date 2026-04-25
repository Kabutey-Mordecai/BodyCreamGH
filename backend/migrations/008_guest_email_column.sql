-- Add explicit guest_email column to orders so we don't rely on regex extraction from notes
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_email VARCHAR(255);

-- Backfill from existing notes using the same regex the model was using
UPDATE orders
SET guest_email = NULLIF(SUBSTRING(notes FROM '<([^>]+)>'), '')
WHERE customer_id IS NULL AND guest_email IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_guest_email ON orders(guest_email) WHERE guest_email IS NOT NULL;

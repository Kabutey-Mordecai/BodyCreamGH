-- 030_guest_order_contact_details.sql
-- Store first-class contact details for guest checkout orders

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS guest_first_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS guest_last_name  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS guest_phone      VARCHAR(50);

-- Backfill from existing notes for guest orders (customer_id IS NULL)
UPDATE orders
SET
  guest_first_name = COALESCE(guest_first_name, NULLIF(SUBSTRING(notes FROM 'Guest:\s*([^\s<]+)'), '')),
  guest_last_name  = COALESCE(guest_last_name,  NULLIF(SUBSTRING(notes FROM 'Guest:\s*[^\s<]+\s+([^<]+)<'), '')),
  guest_phone      = COALESCE(guest_phone,      NULLIF(SUBSTRING(notes FROM 'Phone:\s*([^\n\r]+)'), ''))
WHERE customer_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_guest_phone ON orders(guest_phone) WHERE guest_phone IS NOT NULL;

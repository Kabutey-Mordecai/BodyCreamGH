-- Product visibility toggle (Feature 9).
-- Existing products default to active so no data migration is needed.
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active);

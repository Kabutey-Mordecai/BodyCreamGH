-- Migration 025: Fix cart_items unique constraint to support multiple product variants
-- and enforce positive quantity constraint.

-- 1. Drop the legacy unique constraint on (customer_id, product_id)
ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS cart_items_customer_id_product_id_key;

-- 2. Create unique index on customer_id, product_id, and variant_id (coalesced)
CREATE UNIQUE INDEX IF NOT EXISTS idx_cart_items_user_prod_variant 
  ON cart_items (customer_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- 3. Add quantity check constraint
ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS chk_cart_items_quantity_positive;
ALTER TABLE cart_items ADD CONSTRAINT chk_cart_items_quantity_positive CHECK (quantity > 0);

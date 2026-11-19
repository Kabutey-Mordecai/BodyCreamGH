-- Migration 027: Enforce positive quantity on order_items
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS chk_order_items_quantity_positive;
ALTER TABLE order_items ADD CONSTRAINT chk_order_items_quantity_positive CHECK (quantity > 0);

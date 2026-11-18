-- Migration 026: Composite Performance Indexes for High-Traffic Queries
-- Accelerates storefront category browsing, flash sale resolution, and admin order lookups

CREATE INDEX IF NOT EXISTS idx_orders_fulfillment_payment
  ON orders (fulfillment_method, payment_method);

CREATE INDEX IF NOT EXISTS idx_pv_prod_active_price
  ON product_variants (product_id, is_active, price);

CREATE INDEX IF NOT EXISTS idx_orders_created_status
  ON orders (created_at DESC, status);

CREATE INDEX IF NOT EXISTS idx_products_category_active
  ON products (category, is_active);

CREATE INDEX IF NOT EXISTS idx_promotions_active_dates
  ON promotions (is_active, starts_at, ends_at);

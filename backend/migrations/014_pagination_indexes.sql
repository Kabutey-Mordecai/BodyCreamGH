-- Indexes that make paginated queries fast at production data volumes.
CREATE INDEX IF NOT EXISTS idx_orders_created_at       ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status            ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status    ON orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_cancel_requested  ON orders(cancel_requested) WHERE cancel_requested = true;
CREATE INDEX IF NOT EXISTS idx_orders_return_requested  ON orders(return_requested) WHERE return_requested = true;
CREATE INDEX IF NOT EXISTS idx_products_category        ON products(category);
CREATE INDEX IF NOT EXISTS idx_users_role               ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_created_at         ON users(created_at DESC);

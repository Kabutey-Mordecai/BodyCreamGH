-- Idempotency table: prevents duplicate webhook/event processing
CREATE TABLE IF NOT EXISTS processed_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     VARCHAR(255) UNIQUE NOT NULL,
  event_type   VARCHAR(100) NOT NULL,
  processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_processed_events_id ON processed_events(event_id);

-- Missing performance indexes
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at     ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_reference    ON payments(paystack_reference);
CREATE INDEX IF NOT EXISTS idx_payments_created_at   ON payments(created_at DESC);

-- Phase 8: columns for customer cancel/return request flow
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS cancel_requested        BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancel_reason           TEXT      NULL,
  ADD COLUMN IF NOT EXISTS cancel_requested_at     TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS cancel_request_rejected BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS return_requested        BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS return_reason           TEXT      NULL,
  ADD COLUMN IF NOT EXISTS return_requested_at     TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS return_request_rejected BOOLEAN   NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_orders_cancel_requested ON orders (cancel_requested) WHERE cancel_requested = true;
CREATE INDEX IF NOT EXISTS idx_orders_return_requested ON orders (return_requested) WHERE return_requested = true;

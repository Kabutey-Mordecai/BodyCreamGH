-- Store what is needed to reuse an open Paystack transaction instead of creating
-- a new reference on every init call. Existing rows keep NULL authorization_url
-- and are therefore never reused (they simply age out).
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS authorization_url TEXT,
  ADD COLUMN IF NOT EXISTS access_code       VARCHAR(100),
  ADD COLUMN IF NOT EXISTS currency          VARCHAR(3) NOT NULL DEFAULT 'GHS';

-- Speeds up the "recent pending transaction for this order" lookup.
CREATE INDEX IF NOT EXISTS idx_payments_order_pending
  ON payments (order_id, created_at DESC)
  WHERE status = 'pending';

-- Phase 4A: cancellation and full-refund metadata.
-- No CHECK constraints are added yet because existing order status fields are
-- free-form VARCHARs and need a separate data audit before enforcement.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID NULL REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS stock_restored BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS coupon_returned BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS refund_requested_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS refund_provider_id VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS refund_reference VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS refund_status VARCHAR(30) NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS refund_amount DECIMAL(10, 2) NULL,
  ADD COLUMN IF NOT EXISTS refund_method VARCHAR(30) NULL,
  ADD COLUMN IF NOT EXISTS refund_notes TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_refund_status
  ON orders(refund_status);

CREATE INDEX IF NOT EXISTS idx_orders_refund_reference
  ON orders(refund_reference);

CREATE INDEX IF NOT EXISTS idx_orders_refund_provider_id
  ON orders(refund_provider_id);

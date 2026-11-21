-- 037_partial_returns.sql
-- Adds orders.delivered_at, item-level return_requests & return_request_items tables,
-- and configurable return_window_days setting.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP;

-- Backfill delivered_at for already-delivered orders
UPDATE orders
   SET delivered_at = updated_at
 WHERE status = 'delivered'
   AND delivered_at IS NULL;

CREATE TABLE IF NOT EXISTS return_requests (
  id                   UUID PRIMARY KEY,
  order_id             UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_id          UUID NOT NULL REFERENCES users(id),
  status               VARCHAR(30) NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'rejected', 'cancelled', 'refund_pending', 'refunded', 'refund_failed')),
  reason               TEXT NOT NULL,
  admin_note           TEXT,
  include_delivery_fee BOOLEAN NOT NULL DEFAULT FALSE,
  restock_items        BOOLEAN NOT NULL DEFAULT FALSE,
  stock_restored       BOOLEAN NOT NULL DEFAULT FALSE,
  refund_amount        NUMERIC(10, 2) NOT NULL CHECK (refund_amount > 0),
  refund_method        VARCHAR(20) CHECK (refund_method IS NULL OR refund_method IN ('paystack', 'manual')),
  refund_provider_id   VARCHAR(100),
  refund_reference     VARCHAR(120),
  refund_attempt       INTEGER NOT NULL DEFAULT 0,
  reviewed_by          UUID REFERENCES users(id),
  reviewed_at          TIMESTAMP,
  refunded_at          TIMESTAMP,
  created_at           TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_return_requests_order_id
  ON return_requests (order_id);

CREATE INDEX IF NOT EXISTS idx_return_requests_status
  ON return_requests (status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_return_requests_refund_ref_unique
  ON return_requests (refund_reference)
  WHERE refund_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS return_request_items (
  id                 UUID PRIMARY KEY,
  return_request_id  UUID NOT NULL REFERENCES return_requests(id) ON DELETE CASCADE,
  order_item_id      UUID NOT NULL REFERENCES order_items(id),
  quantity           INTEGER NOT NULL CHECK (quantity > 0),
  unit_refund_amount NUMERIC(10, 2) NOT NULL CHECK (unit_refund_amount >= 0),
  line_refund_amount NUMERIC(10, 2) NOT NULL CHECK (line_refund_amount >= 0),
  UNIQUE (return_request_id, order_item_id)
);

CREATE INDEX IF NOT EXISTS idx_return_request_items_order_item_id
  ON return_request_items (order_item_id);

INSERT INTO site_settings (key, value)
VALUES ('return_window_days', '14')
ON CONFLICT (key) DO NOTHING;

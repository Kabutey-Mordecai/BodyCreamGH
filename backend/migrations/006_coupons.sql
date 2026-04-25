-- Coupon / promo-code system
CREATE TABLE IF NOT EXISTS coupons (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code         VARCHAR(50) UNIQUE NOT NULL,
  type         VARCHAR(20) NOT NULL CHECK (type IN ('percentage', 'fixed')),
  value        DECIMAL(10,2) NOT NULL,
  min_order    DECIMAL(10,2) DEFAULT 0,
  max_uses     INT DEFAULT NULL,        -- NULL = unlimited
  uses_count   INT DEFAULT 0,
  expires_at   TIMESTAMP DEFAULT NULL,  -- NULL = never expires
  active       BOOLEAN DEFAULT true,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Track which coupon (if any) was applied to each order
ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code     VARCHAR(50);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10,2) DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(UPPER(code));

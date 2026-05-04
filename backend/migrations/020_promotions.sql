BEGIN;

CREATE TABLE IF NOT EXISTS promotions (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name           VARCHAR(150)  NOT NULL,
  discount_type  VARCHAR(20)   NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value DECIMAL(12,2) NOT NULL CHECK (discount_value > 0),
  applies_to     VARCHAR(20)   NOT NULL DEFAULT 'all'
                               CHECK (applies_to IN ('all', 'category', 'product')),
  category       VARCHAR(100),
  product_id     UUID REFERENCES products(id) ON DELETE CASCADE,
  starts_at      TIMESTAMPTZ   NOT NULL,
  ends_at        TIMESTAMPTZ   NOT NULL,
  is_active      BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promotions_active
  ON promotions (is_active, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_promotions_product
  ON promotions (product_id) WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_promotions_category
  ON promotions (category) WHERE category IS NOT NULL;

COMMIT;

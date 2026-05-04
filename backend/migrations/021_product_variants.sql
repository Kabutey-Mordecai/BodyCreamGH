BEGIN;

-- ── Variant option types (e.g. "Size", "Scent", "Bundle") ─────────────────────
CREATE TABLE IF NOT EXISTS product_option_types (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name       VARCHAR(100) NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pot_product ON product_option_types(product_id);

-- ── Option values (e.g. "100ml", "250ml", "Lavender") ────────────────────────
CREATE TABLE IF NOT EXISTS product_option_values (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  option_type_id UUID NOT NULL REFERENCES product_option_types(id) ON DELETE CASCADE,
  product_id     UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  value          VARCHAR(150) NOT NULL,
  position       INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pov_type    ON product_option_values(option_type_id);
CREATE INDEX IF NOT EXISTS idx_pov_product ON product_option_values(product_id);

-- ── Variants (one SKU per option combination) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS product_variants (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku              VARCHAR(200) UNIQUE,
  price            DECIMAL(12,2) NOT NULL,
  compare_at_price DECIMAL(12,2),
  stock_quantity   INTEGER NOT NULL DEFAULT 0,
  image_url        TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  position         INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pv_product ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_pv_sku     ON product_variants(sku) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pv_active  ON product_variants(is_active);

-- ── Variant ↔ option value join ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_variant_option_values (
  variant_id      UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  option_value_id UUID NOT NULL REFERENCES product_option_values(id) ON DELETE CASCADE,
  PRIMARY KEY (variant_id, option_value_id)
);

-- ── Extend cart_items with variant columns ─────────────────────────────────────
ALTER TABLE cart_items
  ADD COLUMN IF NOT EXISTS variant_id    UUID REFERENCES product_variants(id),
  ADD COLUMN IF NOT EXISTS variant_label VARCHAR(500);
CREATE INDEX IF NOT EXISTS idx_ci_variant ON cart_items(variant_id) WHERE variant_id IS NOT NULL;

-- ── Extend order_items with variant columns ────────────────────────────────────
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS variant_id    UUID REFERENCES product_variants(id),
  ADD COLUMN IF NOT EXISTS variant_label VARCHAR(500);
CREATE INDEX IF NOT EXISTS idx_oi_variant ON order_items(variant_id) WHERE variant_id IS NOT NULL;

COMMIT;

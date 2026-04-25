-- Product image gallery.
-- Each product supports up to 8 images managed by the admin gallery UI.
-- sort_order controls display sequence in the storefront gallery.
-- is_primary marks the single representative image used on product cards,
-- cart thumbnails, and order line items.
-- The partial unique index enforces one-primary-per-product at the DB level.

CREATE TABLE IF NOT EXISTS product_images (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    UUID          NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url           VARCHAR(1000) NOT NULL,
  filename      VARCHAR(255)  NOT NULL UNIQUE,
  original_name VARCHAR(500),
  mime_type     VARCHAR(100)  NOT NULL,
  size_bytes    INT           NOT NULL CHECK (size_bytes > 0),
  sort_order    INT           NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  is_primary    BOOLEAN       NOT NULL DEFAULT false,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Fast lookup of all images belonging to a product
CREATE INDEX IF NOT EXISTS idx_product_images_product_id
  ON product_images(product_id);

-- Efficient ordered fetch for storefront gallery (ORDER BY sort_order)
CREATE INDEX IF NOT EXISTS idx_product_images_product_sort
  ON product_images(product_id, sort_order);

-- Enforces at most one primary image per product at the database level
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_images_one_primary
  ON product_images(product_id) WHERE is_primary = true;

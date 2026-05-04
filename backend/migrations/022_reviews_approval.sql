-- Extend product_reviews with approval workflow + verified purchase link
ALTER TABLE product_reviews
  ADD COLUMN IF NOT EXISTS order_id         UUID REFERENCES orders(id),
  ADD COLUMN IF NOT EXISTS is_approved      BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_rejected      BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS helpful_count    INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ DEFAULT NOW();

-- Add computed rating columns to products so the "top rated" sort works off
-- a persisted value instead of a live subquery on every request.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS avg_rating    DECIMAL(3,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS review_count  INTEGER      DEFAULT 0;

-- Back-fill any existing approved reviews into the new columns.
-- (If the table was empty this is a no-op.)
UPDATE products p
SET avg_rating = sub.avg,
    review_count = sub.cnt
FROM (
  SELECT product_id,
         ROUND(AVG(rating)::numeric, 2) AS avg,
         COUNT(*)::int                  AS cnt
  FROM product_reviews
  WHERE is_approved = TRUE
  GROUP BY product_id
) sub
WHERE p.id = sub.product_id;

-- Composite index used by the public review list
CREATE INDEX IF NOT EXISTS idx_reviews_product_approved
  ON product_reviews(product_id, is_approved);

CREATE INDEX IF NOT EXISTS idx_reviews_user
  ON product_reviews(user_id);

CREATE INDEX IF NOT EXISTS idx_reviews_order
  ON product_reviews(order_id);

CREATE INDEX IF NOT EXISTS idx_reviews_approved_created
  ON product_reviews(is_approved, created_at DESC);

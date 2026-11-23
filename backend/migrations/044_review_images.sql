-- Add images column to product_reviews for customer photo & swatch uploads
ALTER TABLE product_reviews
  ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]';

-- Ensure GLOW5 coupon exists for abandoned checkout recovery
INSERT INTO coupons (code, type, value, min_order, active)
VALUES ('GLOW5', 'percentage', 5.00, 0, true)
ON CONFLICT (code) DO NOTHING;

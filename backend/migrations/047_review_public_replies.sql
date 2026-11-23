-- Transparent Verified Reviews: Public Admin Replies & Auto-Publish
ALTER TABLE product_reviews
  ADD COLUMN IF NOT EXISTS admin_reply TEXT,
  ADD COLUMN IF NOT EXISTS admin_reply_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_reply_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Publish any previously pending reviews so verified buyer feedback is immediately transparent
UPDATE product_reviews
   SET is_approved = TRUE,
       updated_at = NOW()
 WHERE is_approved = FALSE
   AND is_rejected = FALSE;

-- Keep product average ratings & counts in sync
UPDATE products p
   SET avg_rating = COALESCE((
         SELECT ROUND(AVG(r.rating)::numeric, 2)
           FROM product_reviews r
          WHERE r.product_id = p.id AND r.is_approved = TRUE
       ), 0),
       review_count = (
         SELECT COUNT(*)::int
           FROM product_reviews r
          WHERE r.product_id = p.id AND r.is_approved = TRUE
       );

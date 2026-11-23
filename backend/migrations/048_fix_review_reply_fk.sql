-- Allow replies from both users and admin_accounts by removing the users-only FK on admin_reply_by
ALTER TABLE product_reviews
  DROP CONSTRAINT IF EXISTS product_reviews_admin_reply_by_fkey;

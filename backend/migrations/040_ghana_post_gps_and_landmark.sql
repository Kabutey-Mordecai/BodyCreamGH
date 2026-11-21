-- Add GhanaPostGPS digital address and delivery landmark columns to orders
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS ghana_post_gps VARCHAR(20),
  ADD COLUMN IF NOT EXISTS delivery_landmark VARCHAR(300);

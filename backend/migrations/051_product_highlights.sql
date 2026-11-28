-- Add per-product highlights column (newline-separated bullet points shown in the PDP highlights box)
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS highlights TEXT;

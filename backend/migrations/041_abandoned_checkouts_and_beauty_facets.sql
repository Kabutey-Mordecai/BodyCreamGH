-- 1. Abandoned checkout lead capture & recovery sessions
CREATE TABLE IF NOT EXISTS checkout_sessions (
  id UUID PRIMARY KEY,
  session_token VARCHAR(120) UNIQUE NOT NULL,
  customer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  email VARCHAR(254) NOT NULL,
  first_name VARCHAR(100),
  phone VARCHAR(30),
  items_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  subtotal NUMERIC(10, 2) NOT NULL DEFAULT 0,
  step_reached VARCHAR(40) NOT NULL DEFAULT 'contact',
  recovered_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  reminder_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checkout_sessions_email ON checkout_sessions (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_checkout_sessions_open
  ON checkout_sessions (updated_at DESC)
  WHERE recovered_order_id IS NULL;

-- 2. Typo-tolerant trigram search (safe if DB user lacks superuser)
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- 3. Beauty D2C merchandising facets & structured PDP sections
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS skin_types TEXT[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS skin_concerns TEXT[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS ingredients_inci TEXT,
  ADD COLUMN IF NOT EXISTS how_to_use TEXT,
  ADD COLUMN IF NOT EXISTS safety_notes TEXT;

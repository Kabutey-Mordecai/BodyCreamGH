-- Dedicated Dispatch Riders & Fleet Management table
CREATE TABLE IF NOT EXISTS dispatch_riders (
  id            UUID PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  phone         VARCHAR(40),
  phone_norm    VARCHAR(32),
  vehicle_type  VARCHAR(40)  NOT NULL DEFAULT 'motorbike',
  vehicle_plate VARCHAR(40),
  zone_coverage VARCHAR(160),
  notes         TEXT,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dispatch_riders_name_lower
  ON dispatch_riders (LOWER(TRIM(name)));

CREATE UNIQUE INDEX IF NOT EXISTS idx_dispatch_riders_phone_norm
  ON dispatch_riders (phone_norm)
  WHERE phone_norm IS NOT NULL AND phone_norm <> '';

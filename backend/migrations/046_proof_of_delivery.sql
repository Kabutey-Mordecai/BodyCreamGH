-- Proof of Delivery (POD) columns on deliveries:
-- Zone code (Jumia-style routing), HMAC-hashed 6-digit delivery OTP with attempt lockout,
-- mandatory live camera photo proof, GPS coordinates, and verification timestamp/method.
ALTER TABLE deliveries
  ADD COLUMN IF NOT EXISTS zone_code           VARCHAR(16),
  ADD COLUMN IF NOT EXISTS pod_otp_hash        VARCHAR(64),
  ADD COLUMN IF NOT EXISTS pod_otp_expires_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pod_otp_attempts    INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pod_photo_url       TEXT,
  ADD COLUMN IF NOT EXISTS pod_lat             DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS pod_lng             DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS pod_accuracy        DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS pod_verified_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pod_verified_method VARCHAR(40),
  ADD COLUMN IF NOT EXISTS pod_recipient_name  VARCHAR(120);

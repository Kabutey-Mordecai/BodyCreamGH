-- 050_rider_security_hardening.sql
-- Adds token_version to dispatch_riders for instant WhatsApp link revocation
-- and pod_otp_sent_at to deliveries for per-stop OTP resend cooldown enforcement.

ALTER TABLE IF EXISTS dispatch_riders
  ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE IF EXISTS deliveries
  ADD COLUMN IF NOT EXISTS pod_otp_sent_at TIMESTAMPTZ;

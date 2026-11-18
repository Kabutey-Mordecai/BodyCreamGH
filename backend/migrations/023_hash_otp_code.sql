-- Widen users.otp_code from VARCHAR(6) to VARCHAR(64) to store HMAC-SHA256 hex digests
-- and clear any active plaintext OTPs so admins restart MFA cleanly after rollout.
ALTER TABLE users ALTER COLUMN otp_code TYPE VARCHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_attempts INTEGER NOT NULL DEFAULT 0;
UPDATE users SET otp_code = NULL, otp_expires_at = NULL, otp_attempts = 0;

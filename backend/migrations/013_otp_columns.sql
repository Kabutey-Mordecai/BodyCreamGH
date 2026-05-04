-- Admin MFA: OTP columns on users table
-- otp_code        — 6-digit code sent to admin email
-- otp_expires_at  — code is valid for 10 minutes
-- otp_attempts    — incremented on each wrong guess; max 5 before lockout
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS otp_code       VARCHAR(6),
  ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS otp_attempts   INT DEFAULT 0;

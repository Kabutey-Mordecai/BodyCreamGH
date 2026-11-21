-- Migration 034: Password reset PIN hardening
-- Adds per-token attempt counter so 5 failed attempts invalidate the active PIN,
-- and invalidates any legacy unhashed reset tokens.

ALTER TABLE password_reset_tokens
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;

UPDATE password_reset_tokens
   SET used = true
 WHERE used = false;

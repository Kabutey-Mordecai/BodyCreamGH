-- Admin account management (Feature 6).
-- is_active: deactivated admins cannot log in.
-- last_login_at: displayed in Admin Accounts page.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active      BOOLEAN   NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at  TIMESTAMP;

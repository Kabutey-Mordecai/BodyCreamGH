-- Migration 043: Dedicated unguessable single-purpose opt-out token for abandoned checkouts
ALTER TABLE checkout_sessions
  ADD COLUMN IF NOT EXISTS opt_out_token VARCHAR(120);

CREATE UNIQUE INDEX IF NOT EXISTS idx_checkout_sessions_opt_out_token
  ON checkout_sessions (opt_out_token)
  WHERE opt_out_token IS NOT NULL;

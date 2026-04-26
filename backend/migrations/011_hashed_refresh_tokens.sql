-- =============================================================================
-- 011_hashed_refresh_tokens.sql
--
-- Migrate refresh token storage from plaintext to SHA-256 hash.
--
-- WHY: A DB dump or SQL-injection exposure would reveal all active refresh
-- tokens, allowing an attacker to impersonate every logged-in user.
-- Storing SHA-256(token) means the raw token is never at rest in the DB.
-- Refresh tokens are 40 bytes of CSPRNG output (320 bits of entropy), so a
-- fast hash is sufficient — bcrypt's cost factor is not needed here.
--
-- EFFECT ON EXISTING SESSIONS:
-- All current refresh tokens are invalidated. Users whose access token (15 min
-- JWT) has not yet expired will notice only when it does. After that they must
-- re-login. Access tokens are unaffected by this migration.
-- =============================================================================

-- Invalidate and remove all existing plaintext tokens.
-- The raw tokens cannot be retroactively hashed — we never stored them.
DELETE FROM refresh_tokens;

-- Remove the plaintext column. Dropping the column also automatically drops
-- the associated idx_refresh_tokens_token index in PostgreSQL.
ALTER TABLE refresh_tokens DROP COLUMN token;

-- Add the hash column. CHAR(64) is exactly the length of a hex-encoded SHA-256 digest.
-- NOT NULL: every new row must carry a hash (empty table, so no backfill needed).
ALTER TABLE refresh_tokens ADD COLUMN token_hash CHAR(64) NOT NULL;

-- Unique index: prevents hash collisions from being stored and enables O(1) lookup.
CREATE UNIQUE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);

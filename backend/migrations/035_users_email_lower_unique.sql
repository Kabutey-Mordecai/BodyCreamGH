-- Migration 035: Enforce case-insensitive email uniqueness on users
-- Aborts safely if duplicate lower(email) rows exist (never auto-deletes).

DO $$
DECLARE
  dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT LOWER(TRIM(email))
      FROM users
     GROUP BY LOWER(TRIM(email))
    HAVING COUNT(*) > 1
  ) d;

  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Cannot create unique lower(email) index: % duplicate case-insensitive email group(s) exist in users. Resolve manually first.', dup_count;
  END IF;
END $$;

UPDATE users
   SET email = LOWER(TRIM(email))
 WHERE email <> LOWER(TRIM(email));

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower_unique
  ON users (LOWER(email));

-- Normalize any unexpected payments.status values before adding CHECK constraint
UPDATE payments
   SET status = 'needs_review'
 WHERE status IS NULL
    OR status NOT IN ('pending', 'success', 'failed', 'abandoned', 'duplicate', 'refunded', 'needs_review');

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_status_check;

ALTER TABLE payments
  ADD CONSTRAINT payments_status_check
  CHECK (status IN ('pending', 'success', 'failed', 'abandoned', 'duplicate', 'refunded', 'needs_review'));

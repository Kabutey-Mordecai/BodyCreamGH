-- Allow 'refund_pending' on payments.status for in-flight duplicate-payment refunds
ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_status_check;

ALTER TABLE payments
  ADD CONSTRAINT payments_status_check
  CHECK (status IN ('pending', 'success', 'failed', 'abandoned', 'duplicate', 'refund_pending', 'refunded', 'needs_review'));

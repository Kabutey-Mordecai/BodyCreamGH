# BodyCreamGH — Staging Verification & Paystack Test-Mode Plan

Run every step below on staging against **Paystack Test Mode** (`sk_test_...`) before flipping `PARTIAL_RETURNS_ENABLED=true` or cutting over to live keys.

> **Security rule:** Never paste `PAYSTACK_SECRET_KEY`, `Authorization` headers, `x-paystack-signature` values, JWTs, or SMTP passwords into PRs, tickets, or logs.

---

## Pre-Flight Checks

1. **Back up the database before running migrations `036`, `037`, `038`:**
   ```bash
   pg_dump --format=custom --no-owner --no-privileges \
     -h "$DB_HOST" -p "${DB_PORT:-5432}" -U "$DB_USER" \
     -f "backup_pre_partial_returns_$(date +%Y%m%d_%H%M%S).dump" \
     "$DB_NAME"
   ```
2. **Environment on staging:**
   - `COURIER_MODE=manual`
   - `PARTIAL_RETURNS_ENABLED=true` (also verify flag-off behaviour first when unset/`false`)
   - `OTP_HMAC_SECRET` and `JWT_SECRET` freshly generated (64-char hex each)
   - Both `server.js` and `worker.js` running under PM2/systemd
3. **Log leak reminder (repeat after EVERY step below):**
   ```bash
   grep -iE "Authorization|Bearer sk_" /var/log/bodycreamgh/*.log
   ```
   Must return **0 lines**.

---

## Test Scenarios

### (a) Real Paystack Test-Mode Card Payment
- **Steps:** Log in as a test customer on Web or Mobile, add 3 units of an in-stock product (e.g. GHS 50.00 each, total GHS 150.00), checkout via Paystack hosted checkout using a Paystack test card.
- **Expected:** Redirect returns to callback; order transitions to `status = 'confirmed'`, `payment_status = 'paid'`.
- **DB check:**
  ```sql
  SELECT id, order_number, status, payment_status, total_amount, payment_reference
    FROM orders WHERE order_number = '<ORD-...>';
  SELECT id, status, amount, paystack_reference FROM payments WHERE order_id = '<order_id>';
  ```
- **Logs check:** `Payment verified` / `Order confirmation email sent`, **no** `Authorization` header in logs.

### (b) Partial Return & Refund of 1 Item
- **Steps:**
  1. Mark the order delivered via manual courier (`POST /api/deliveries` with a real/test tracking number, then update delivery status to `delivered`).
  2. Confirm `orders.delivered_at` is populated.
  3. As the customer, open Order Detail → Request Return → select 1 of 3 units → submit reason.
  4. As admin, open Admin `Requests` (verify pending count incremented) and `OrderDetail` → approve with `restock_items = false` (default) and `include_delivery_fee = false`.
- **Expected:**
  - `return_requests` row transitions `pending` → `refund_pending` (with `refund_reference = RET-...-1`) → `refunded` after Paystack `refund.processed` webhook (or 30-min reconciler).
  - `orders.status` stays `'delivered'`, `orders.payment_status = 'partially_refunded'`, `orders.refund_amount = 50.00`.
  - Product stock unchanged (`restock_items = false`).
- **Capture real webhook body (REQUIRED before production launch):**
  - Temporarily log the parsed `req.body` (NOT headers/signature) of the real `refund.processed` webhook from Paystack test mode and also capture one `GET https://api.paystack.co/refund?reference=<tx_ref>` response (redact keys/emails).
  - Confirm whether Paystack echoes `merchant_note` and/or `reference` in both payloads, and **paste the redacted JSON into the PR**.

### (c) Second Partial Return of the Exact Same Amount (GHS 50.00)
- **Steps:**
  1. As the same customer, submit a second partial return for 1 more unit (also GHS 50.00).
  2. Approve as admin with `restock_items = true`.
- **Expected:**
  - Second `return_requests` row gets a distinct `RET-...-1` reference and settles independently to `refunded`.
  - `orders.refund_amount` becomes `100.00`; `orders.payment_status` remains `'partially_refunded'`.
  - Product stock increments by `+1` and `inventory_history` has a `reason = 'return_restock'` row.
- **DB check:**
  ```sql
  SELECT id, status, refund_amount, refund_provider_id, refund_reference, stock_restored
    FROM return_requests WHERE order_id = '<order_id>' ORDER BY created_at;
  SELECT reason, quantity_change, notes FROM inventory_history WHERE product_id = '<product_id>' ORDER BY created_at DESC LIMIT 3;
  ```

### (d) Full Refund of the Remainder
- **Steps:** As admin, click **Refund order** (Paystack) on the same `partially_refunded` order (remaining balance GHS 50.00).
- **Expected:**
  - Paystack `POST /refund` is called for **5000 pesewas (GHS 50.00)** — NOT the original GHS 150.00.
  - After webhook/reconciliation: `orders.refund_status = 'success'`, `orders.status = 'refunded'`, `orders.payment_status = 'refunded'`, `orders.refund_amount = 150.00`.

### (e) Forced Duplicate Payment & Its Refund
- **Steps:**
  1. Insert a second `payments` row on a paid order with `status = 'duplicate'` referencing a second real test-mode Paystack charge.
  2. Open Admin `OrderDetail` → confirm the **Duplicate Payments** card appears → click **Refund duplicate**.
- **Expected:**
  - `payments.status` moves `duplicate` → `refund_pending` → `refunded` (via webhook or reconciler).
  - Winning `payments` row remains `'success'` and `orders.payment_status` remains `'paid'`.
  - `order_status_log` records the duplicate reference, Paystack refund ID, and amount.

### (f) Manual-Courier Shipment with Tracking Number
- **Steps:**
  1. Confirm `COURIER_MODE=manual` is active (and confirm `COURIER_MODE=mock` or `live` refuses to start in production).
  2. Place and pay for a delivery order → confirm **no** fake `TRK-...` row is auto-created by `shipment.worker.js` and **no** shipped email is sent.
  3. Attempt `POST /api/deliveries` without `tracking_number` → confirm `400`.
  4. Submit `POST /api/deliveries` with a real tracking number → confirm `201`, shipping email sent, and updating delivery to `delivered` sets `orders.delivered_at`.

### (g) Mobile Money (MoMo) Payment & Partial Refund
- **Steps:**
  1. Complete a Paystack test-mode Mobile Money payment (GHS).
  2. Mark delivered, request and approve a partial return for 1 item.
- **Expected:**
  - Confirm `refund.pending` / `refund.processed` (or `refund.failed` if simulated failure) transitions `return_requests.status` cleanly, and that a `refund_failed` row can be retried from Admin `OrderDetail` without double-refunding.

---

## Final Log & DB Hygiene Check
- Confirm `SELECT COUNT(*) FROM pgboss.job WHERE output::text ~* 'Authorization|Bearer'` returns **`0`**.
- Confirm `grep -iE "Authorization|Bearer sk_" /var/log/bodycreamgh/*.log` returns **0 lines**.

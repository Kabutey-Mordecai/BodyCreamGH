# BodyCreamGH Flutter App — Device Manual Test Checklist

Use this checklist on a physical Android/iOS device or emulator against staging before releasing a new mobile build.

---

## 1. Track an Order (`POST /api/orders/track`) — New & Legacy Order Numbers
- [ ] Open **Orders → Track a Guest Order** (or `/track-order`).
- [ ] **New base32 order number (`ORD-<8 base32>`):**
  - Enter a new order number with a leading `#` and lowercase characters (e.g. `#ord-23456789`) and the order's email address.
  - Tap **Track Order** → confirm the input normalizes to `ORD-23456789` and displays the 5-step progress tracker, items, and total.
  - If the order is **paid**, confirm no "Complete Payment" button is shown (the server omits `id` for paid orders) and the screen does not attempt to navigate to `/orders/:id`.
  - If the order is **unpaid**, confirm the **Complete Payment** button appears and opens the Paystack checkout WebView.
- [ ] **Legacy numeric order number (`ORD-<digits>`):**
  - Enter a legacy order number (e.g. `ORD-100042` or `#ord-20240429-0012`) with its matching email → confirm lookup succeeds identically.
- [ ] **Wrong email / unknown order (`404`):**
  - Enter a valid order number with a different email → confirm the identical `Order not found` banner is displayed without leaking whether the order number exists.
- [ ] **Rate limit (`429`):**
  - Rapidly submit >10 failed lookups → confirm the `429` rate-limit message from the server is displayed in the error banner.

---

## 2. Forgot Password with Wrong & Correct 6-Digit PIN
- [ ] Go to **Account → Log In → Forgot password?**.
- [ ] Enter your account email and tap **Send 6-Digit Code**.
- [ ] **Wrong PIN & Attempts Exceeded:**
  - Enter an incorrect 6-digit PIN (`000000`) and tap **Verify Code** → confirm the server error message is displayed inside the dialog.
  - Repeat wrong PIN attempts until the server returns the attempts-exceeded / rate-limit (`400` / `429`) error → confirm the message is shown clearly and **Resend code** requests a fresh 6-digit PIN.
- [ ] **Correct 6-Digit PIN & Session Reset:**
  - Enter the valid 6-digit PIN → confirm the dialog advances to **Set New Password**.
  - Enter a strong password meeting all 4 requirements and tap **Update Password**.
  - Confirm any stored access/refresh tokens are cleared (`ApiService.clearTokens()` + `onSessionExpired`), the app remains on **Log In** with no `401` refresh loop, and signing in with the new password succeeds.

---

## 3. Submit a Product Review Twice (`409` Duplicate & `429` Rate Limit)
- [ ] Log in as a customer with a delivered order.
- [ ] **From Order Detail ("How did we do?"):**
  - Select a star rating, enter a review, and tap **Submit Review** → confirm `"Review submitted — thank you!"` and the card transitions to `"Thank you for your review!"`.
- [ ] **Second submission (`409 Conflict`):**
  - Open the same product's **Product Detail** screen (or attempt a second submission before refreshing) and submit another review → confirm the `409` response marks the product as already reviewed (`already_reviewed: true`), closes the review sheet, and shows the server message without crashing.

---

## 4. Store Pickup Order (`fulfillment_method = 'pickup'`)
- [ ] Place an order selecting **Store Pickup** at checkout (`delivery_fee = 0`).
- [ ] Open **Order Detail** and **Track Your Order**:
  - Confirm the **Fulfillment: Store Pickup** card is shown (`"We will notify you when your order is ready for pickup."`) instead of courier tracking rows.
  - After admin marks the order `delivered`, confirm the card displays `"Picked up"`.

---

## 5. Manual-Courier Order (`COURIER_MODE=manual`) Without & With Tracking Number
- [ ] Place and pay for a delivery order while the backend runs with `COURIER_MODE=manual`.
- [ ] Have admin move the order to `processing` or `shipped` before a delivery/tracking record exists:
  - Open **Order Detail** and **Track Your Order** → confirm no fake `TRK-...` number appears and the shipment card cleanly states `"Courier & tracking number will appear here once assigned."` (or `Tracking #: Pending assignment`).
- [ ] Have admin create the delivery record with a real tracking number → pull-to-refresh on **Order Detail** and confirm Courier name, Tracking #, and shipment progress steps appear.

---

## 6. Partial Returns (`PARTIAL_RETURNS_ENABLED` Off vs On)
- [ ] **Flag OFF (`PARTIAL_RETURNS_ENABLED=false` or unset):**
  - Open **Order Detail** for a delivered, paid order (`GET /api/settings` returns `partial_returns_enabled: false`).
  - Tap **Request return** → confirm the item-level picker is **hidden** and the legacy single-reason return dialog opens (`POST /api/orders/:id/request-return`).
  - If an item-level return request is already open on that order, confirm the server's `409` message is displayed verbatim in a SnackBar.
- [ ] **Flag ON (`PARTIAL_RETURNS_ENABLED=true`):**
  - Open **Order Detail** for a delivered, paid order with multiple items.
  - Tap **Request return** → confirm the **Select Items to Return** dialog opens using `remaining_quantity` from `GET /api/orders/:id/returns`.
  - Select 1 item, enter a reason, and tap **Submit Return** → confirm the SnackBar displays the **server-calculated refund amount** (`Return request submitted (Refund: GHS XX.XX)`), and the new return card appears in the Return section.
  - Test an order with `delivered_at IS NULL` or older than `return_window_days` (14 days) → confirm the server's `400` message (`"Delivery date could not be verified..."` or `"Return window of 14 days has expired..."`) is shown verbatim.
  - After 1 partial return is refunded (`payment_status = 'partially_refunded'`), confirm the `Partially Refunded` badge and `Refunded: -GHS XX.XX` row appear and **Request return** remains available for the remaining items.

---

## 7. Cancel a Pending Return Request
- [ ] On **Order Detail** with an open `pending` partial return card, tap **Cancel return request** (`POST /api/orders/:id/returns/:returnId/cancel`).
- [ ] Confirm the SnackBar shows `"Return request cancelled"`, the return card status updates to `Cancelled`, and the item's `remaining_quantity` is restored in the return picker.

---

## 8. Deep Link to `/orders/:id`
- [ ] Trigger a deep link / route navigation to `/orders/<valid-order-uuid>` (and `/order/<valid-order-uuid>`):
  - Confirm `GoRouter` (`mobile/lib/main.dart:167-186`) opens `OrderDetailScreen(orderId: ...)` and loads the order.
  - Test `/orders/<non-existent-uuid>` → confirm the error message and **Retry** / **Back to Orders** buttons render cleanly without an unhandled exception.

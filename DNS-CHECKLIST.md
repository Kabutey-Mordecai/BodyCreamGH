# DNS & Email Deliverability Checklist (Brevo Custom Domain)

Why: Sending transactional emails from a freemail address (`@gmail.com`, `@yahoo.com`, `@outlook.com`) triggers Gmail/Yahoo/Microsoft bulk-sender spam filters. Authenticating a custom domain with **DKIM + DMARC** in Brevo routes Order Confirmations, 6-Digit Delivery OTPs, and Proof-of-Delivery receipts to the primary Inbox.

## 1. Prerequisites
- Own a custom domain (e.g. `bodycreamgh.com` via Cloudflare, Namecheap, Porkbun, or Vercel Domains).
- Brevo account with `BREVO_API_KEY` active on Railway.

## 2. Brevo Domain Authentication Steps
1. Open **Brevo → Senders, Domains & Dedicated IPs → Domains → Add a domain**.
2. Enter your domain (e.g. `bodycreamgh.com`).
3. Add the exact DNS records Brevo generates into your DNS provider:
   - **Brevo verification TXT record** (`@` or root)
   - **DKIM CNAME records** (account-unique, e.g. `mail._domainkey` / `brevo1._domainkey` — never copy from another account)
   - **DMARC TXT record** at `_dmarc`:
     - Start with monitoring: `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com`
     - After 1–2 weeks of clean reports, tighten to `p=quarantine` or `p=reject`.
4. Wait for DNS propagation (usually 5–30 minutes; up to **48 hours** max) and click **Verify & Authenticate** in Brevo.

## 3. Railway Environment Variables
Update these in **Railway → `bodycreamgh-demo` → `backend` → Variables**:
- `EMAIL_FROM` = `BodyCream GH <orders@bodycreamgh.com>`
- `EMAIL_REPLY_TO` = `support@bodycreamgh.com` *(optional — routes customer replies to your support inbox)*

## 4. Verification
- Check Railway startup logs for:
  - `Brevo HTTPS email API verified`
  - **No** `EMAIL_FROM uses a freemail domain` warning.
- Place a test order or trigger **Resend OTP** and inspect the email headers (`Show original` in Gmail) to confirm **`DKIM: PASS`** and **`DMARC: PASS`**.

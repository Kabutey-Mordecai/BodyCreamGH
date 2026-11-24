# BodyCreamGH — Buyer Handoff & Production Cutover Guide

This repository is currently configured for **demo mode** (Railway local volume for `/app/uploads`, demo admin/payment/email settings). Before handing over to a live buyer or switching to full production, complete the checklist below.

---

## 1. Remove Demo-Only Flags & Settings

Before going live with real customers, review and remove/rotate these demo-only settings on the `backend` service:

- **`DEMO_SKIP_ADMIN_MFA`**: Remove or set to `false` so admin logins require MFA/OTP verification.
- **`PAYSTACK_SECRET_KEY` / `PAYSTACK_PUBLIC_KEY`**: Replace `sk_test_...` / `pk_test_...` with live Paystack keys (`sk_live_...` / `pk_live_...`).
- **Secrets rotation**: Generate fresh production values for `JWT_SECRET`, `OTP_HMAC_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`.
- **`RAILWAY_RUN_UID=0`**: Currently set so the Railway Volume at `/app/uploads` is writable by the container. Once you switch to `STORAGE_DRIVER=r2` and detach the volume, you may remove `RAILWAY_RUN_UID=0`.

---

## 2. Required Environment Variables by Feature

See [`backend/.env.example`](backend/.env.example) for the full template.

### A. File Storage (`STORAGE_DRIVER`)
- **Demo / Single-Instance Railway Volume (current default):**
  - `STORAGE_DRIVER=local` (or unset)
  - Mount a Railway Volume at `/app/uploads` (single replica only).
- **Production Multi-Instance / Durable Object Storage (Cloudflare R2):**
  - `STORAGE_DRIVER=r2`
  - `R2_ACCOUNT_ID` — Cloudflare account ID
  - `R2_ACCESS_KEY_ID` — R2 API token access key
  - `R2_SECRET_ACCESS_KEY` — R2 API token secret key
  - `R2_BUCKET` — R2 bucket name
  - `R2_PUBLIC_BASE_URL` — Public R2/custom CDN URL (no trailing slash, e.g. `https://cdn.yourdomain.com`)

> Note: When `STORAGE_DRIVER=r2`, the backend fails fast at startup if any `R2_*` variable is missing.

### B. SMS / Delivery OTP (`notification.service.js`)
- `SMS_PROVIDER` — `arkesel`, `hubtel`, or `mnotify`
- `SMS_API_KEY` — Provider API key (or `clientSecret` for Hubtel)
- `SMS_SENDER_ID` — Approved sender ID (max 11 alphanumeric characters)
- `SMS_CLIENT_ID` — Required **only** when `SMS_PROVIDER=hubtel`
- Optional fallback:
  - `SMS_FALLBACK_PROVIDER` — `arkesel`, `hubtel`, or `mnotify`
  - `SMS_FALLBACK_API_KEY` — Fallback provider API key

Verify SMS delivery with:
```bash
node backend/scripts/test-sms.js 0XXXXXXXXX
```

### C. Transactional Email (`email.service.js`)
- `BREVO_API_KEY` — Brevo transactional email API key (preferred over SMTP on Railway)
- `EMAIL_FROM` — Authenticated sender, e.g. `BodyCreamGH <noreply@yourdomain.com>`
- `EMAIL_REPLY_TO` — Customer support reply-to address
- Optional SMTP fallback (only if not using Brevo HTTP API): `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`

### D. Payments & Webhooks (Paystack)
- `PAYSTACK_SECRET_KEY` — `sk_live_...`
- `PAYSTACK_PUBLIC_KEY` — `pk_live_...`
- Configure the Paystack webhook URL in the Paystack Dashboard to:
  `https://<your-backend-domain>/api/payments/webhook`

### E. Domain, CORS & Rate Limiting
- `NODE_ENV=production`
- `TRUST_PROXY=1` (required behind Railway/reverse proxy for accurate client IPs)
- `BASE_URL` — Public backend API origin (e.g. `https://api.yourdomain.com`)
- `FRONTEND_URL` — Public storefront origin (e.g. `https://yourdomain.com`)
- `ALLOWED_ORIGINS` — Comma-separated storefront + admin origins
- Optional rate-limit tuning (defaults are CGNAT-safe):
  - `GLOBAL_IP_MAX=600`
  - `LOGIN_IP_MAX=300`
  - `LOGIN_ACCT_MAX=60`
  - `REGISTER_IP_MAX=40`

---

## 3. DNS & Email Authentication Steps

Follow [`DNS-CHECKLIST.md`](DNS-CHECKLIST.md) before sending production emails:
1. Point your storefront and admin custom domains to Vercel, and your API subdomain (`api.yourdomain.com`) to Railway.
2. Add Brevo domain authentication records (**DKIM** CNAME/TXT, **SPF** `include:spf.brevo.com`, and **DMARC** `_dmarc` TXT) in your DNS provider.
3. Verify the domain shows **Authenticated** in Brevo and send a test order email to confirm `SPF`, `DKIM`, and `DMARC` pass in message headers.

---

## 4. Migrating Existing `/uploads/` Files to Cloudflare R2

If switching an existing deployment from `STORAGE_DRIVER=local` (Railway Volume) to `STORAGE_DRIVER=r2`:

1. Ensure `DATABASE_URL`, `STORAGE_DRIVER=r2`, and all `R2_*` environment variables are set in the environment where `/app/uploads` is mounted (for example via `railway ssh` inside the `backend` container).
2. Run a dry run first (reads DB rows and checks local files without uploading or modifying the database):
   ```bash
   node scripts/migrate-uploads-to-r2.js --dry-run
   ```
3. Run the live migration (uploads files to R2 and updates `products.image_url`, `product_images.url`, `product_variants.image_url`, `deliveries.pod_photo_url`, and `product_reviews.images` JSONB arrays; original files on disk are preserved):
   ```bash
   node scripts/migrate-uploads-to-r2.js
   ```
4. Verify images load from `R2_PUBLIC_BASE_URL` in both storefront and admin before removing the Railway Volume.

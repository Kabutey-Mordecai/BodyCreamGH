# BodyCream GH — Build Progress

Last updated: 2026-04-25

---

## ✅ DONE — Backend (`backend/`)

### Core (from guide)
- [x] Auth: register, login, JWT access + refresh tokens, logout
- [x] Forgot password / reset password (email link)
- [x] Products CRUD (create, read, update, delete)
- [x] Cart management (add, update, remove, clear)
- [x] Orders: create (auth'd), guest checkout, admin view all, status updates
- [x] Order status audit log (`order_status_log` table)
- [x] Paystack payment: initialize, verify, webhook handler
- [x] Inventory tracking + history (`inventory_history` table)
- [x] Admin endpoints: dashboard stats, analytics, top products, customers, reviews
- [x] Customer profiles

### Beyond the guide
- [x] Product reviews (`product_reviews` table, per-product + per-user)
- [x] Wishlist (`wishlists` table)
- [x] Delivery / shipment tracking (`deliveries` table, tracking numbers)
- [x] Coupons: percentage & fixed, min_order, max_uses, expiry, deactivate, delete
- [x] Site settings (key-value store, used by Storefront Editor + Theme Customizer)
- [x] Email notifications: order confirmation, review request after delivery
- [x] Event system: `payment.handler` (paid → confirmed), `shipment.handler` (delivered → review email)
- [x] Rate limiting middleware
- [x] Refresh-token interceptor (admin + frontend, pending-queue pattern)
- [x] Guest checkout orders (no account required)
- [x] Paystack metadata fallback: DB lookup by reference when orderId missing from metadata

### Migrations run
- [x] `001_create_tables.sql`
- [x] `002_auth_tokens.sql`
- [x] `002_site_settings.sql`
- [x] `003_reviews.sql`
- [x] `004_wishlists.sql`
- [x] `005_tracking_system.sql`
- [x] `006_coupons.sql`
- [x] `007_production_hardening.sql`  ← processed_events table + perf indexes
- [x] `008_guest_email_column.sql`    ← guest_email column + backfill + index

---

## ✅ DONE — Frontend (`frontend/`)

### Core (from guide)
- [x] Home page
- [x] Shop (product listing, filters, search)
- [x] Product detail page
- [x] Cart page
- [x] Checkout (delivery details, region-based delivery fee, Paystack redirect)
- [x] Payment callback (verify + redirect to orders)
- [x] Orders list page
- [x] Order detail (items, status, tracking info)
- [x] User account page (profile, password change)
- [x] Login / Register
- [x] Forgot password / Reset password

### Beyond the guide
- [x] Wishlist page (add/remove, persisted to server when logged in)
- [x] Guest checkout (no account needed)
- [x] Promo code / coupon input at checkout (validates server-side)
- [x] Orders grouped by date (Today / Yesterday / This week / Month Year)
- [x] On-site review prompt after delivery (star rating + title + body per product)
- [x] `review-status` check — already-reviewed products show thank-you, not form
- [x] Cart clears on server + locally after successful checkout
- [x] Auth context, Cart context, Settings context, Wishlist context
- [x] Announcement bar, Footer, Navigation, Trust strip, Star rating component
- [x] Refresh-token interceptor (auto re-auth on 401)

---

## ✅ DONE — Admin (`admin/`)

### Core (from guide)
- [x] Dashboard (revenue, orders, customers, low stock stats + recent orders table)
- [x] Products list + Product editor (create / edit)
- [x] Orders list (with 30s auto-polling, manual refresh)
- [x] Order detail (status change, note, status timeline)
- [x] Customers list
- [x] Inventory (stock levels, adjust stock)
- [x] Analytics (sales charts, top products)

### Beyond the guide
- [x] Coupons (create with Generate button, deactivate, delete; status badges)
- [x] Reviews moderation (view all reviews, delete)
- [x] Storefront Editor (hero text, featured products, announcement bar)
- [x] Theme & Colors customizer (CSS variable overrides)
- [x] Settings page (delivery fees, free delivery threshold, store info)
- [x] Customer detail drill-down (profile + order history)
- [x] Print invoice utility
- [x] Refresh button + "Updated HH:MM" timestamp on Orders + Dashboard
- [x] `payment_status` column shown on Dashboard recent orders

---

## ✅ DONE — Mobile App (`mobile/`)

Full Flutter app built. Targets Android (iOS buildable with same code).

### Files
- [x] `pubspec.yaml` — http, flutter_secure_storage, provider, go_router, webview_flutter, cached_network_image, intl
- [x] `lib/config.dart` — `AppConfig.baseUrl` (overridable via `--dart-define=API_URL=…`)
- [x] `lib/models/` — `product.dart`, `cart_item.dart`, `order.dart`, `user.dart`
- [x] `lib/services/api_service.dart` — singleton, silent JWT refresh (retry once on 401), all API calls
- [x] `lib/services/auth_service.dart` — login, register, logout, session restore
- [x] `lib/providers/auth_provider.dart` — `ChangeNotifier`, `AuthStatus` enum, `init()` restores session
- [x] `lib/providers/cart_provider.dart` — add/remove/update, subtotal+delivery+discount totals, `toOrderPayload()`
- [x] `lib/widgets/product_card.dart` — image, price, add-to-cart, out-of-stock guard
- [x] `lib/widgets/cart_badge.dart` — count badge on cart icon
- [x] `lib/widgets/status_chip.dart` — colour-coded chip for order/payment/delivery status
- [x] `lib/screens/home_screen.dart` — hero banner, featured products grid, shop-now CTA
- [x] `lib/screens/shop_screen.dart` — search bar, category filter chips, infinite-scroll grid
- [x] `lib/screens/product_detail_screen.dart` — image, description, quantity picker, add-to-cart
- [x] `lib/screens/cart_screen.dart` — item list, qty controls, summary, checkout button
- [x] `lib/screens/checkout_screen.dart` — delivery address, coupon validation, order totals, Paystack pay button
- [x] `lib/screens/payment_screen.dart` — WebView loads Paystack hosted page, intercepts callback redirect
- [x] `lib/screens/orders_screen.dart` — order list with status chips, pull-to-refresh
- [x] `lib/screens/order_detail_screen.dart` — status, delivery address, item breakdown, post-payment snackbar
- [x] `lib/screens/account_screen.dart` — profile header, navigation tiles, logout
- [x] `lib/screens/login_screen.dart` — email + password, form validation
- [x] `lib/screens/register_screen.dart` — name, email, phone (optional), password
- [x] `lib/main_shell.dart` — `StatefulShellRoute` wrapping 5-tab bottom nav
- [x] `lib/main.dart` — `MultiProvider`, `GoRouter` with auth redirect guard
- [x] `android/app/src/main/AndroidManifest.xml` — INTERNET permission, deep-link intent filter for Paystack callback

### Run the app
```bash
cd mobile
flutter pub get
# Android emulator / physical device:
flutter run
# Build release APK:
flutter build apk --release --dart-define=API_URL=https://api.yourdomain.com/api
```

---

## ✅ DONE — Docker Containerisation

- [x] `backend/Dockerfile` — multi-stage production build (Stage 1: `npm ci --omit=dev`; Stage 2: non-root `nodejs:1001` user, HEALTHCHECK)
- [x] `backend/Dockerfile.dev` — dev image with nodemon, source mounted as volume
- [x] `backend/.dockerignore` — excludes `node_modules/`, `.env`, logs, editor files
- [x] `docker-compose.yml` — local dev stack (postgres:15-alpine + backend with hot-reload)
- [x] `docker-compose.prod.yml` — production stack (db + backend + nginx:alpine with SSL mounts)
- [x] `backend/migrations/run.js` — idempotent runner (tracks applied files in `schema_migrations` table)

### Usage
```bash
# Local dev
docker-compose up

# Production (on server)
docker-compose -f docker-compose.prod.yml up -d --build
docker-compose -f docker-compose.prod.yml exec backend npm run migrate
```

---

## ✅ DONE — GitHub Actions CI/CD

- [x] `.github/workflows/ci.yml` — triggered on push + PR to main
  - `backend` job: `npm ci`, `node --check` all source files, `npm audit --audit-level=high`
  - `frontend` job: `npm ci`, `npm run build` (with placeholder `VITE_API_URL`), upload dist artifact
  - `admin` job: same as frontend
  - `concurrency` group cancels in-progress runs on fast pushes
- [x] `.github/workflows/deploy.yml` — triggered on push to `main` (backend/docker files only)
  - Builds production Docker image, pushes to GHCR (`ghcr.io/<repo>/backend`)
  - Layer caching via `type=registry` cache
  - SSHes to server: `git pull → docker pull → docker-compose up --no-deps backend → migrate → image prune`
  - Writes deployment summary to GitHub Actions job summary page

### Secrets to add in GitHub (Settings → Secrets → Actions)
| Secret | Value |
|---|---|
| `DEPLOY_HOST` | Server IP or hostname |
| `DEPLOY_USER` | SSH user (e.g. `deploy`) |
| `DEPLOY_SSH_KEY` | Private key (`~/.ssh/id_ed25519` contents) |
| `DEPLOY_PORT` | SSH port (usually `22`) |

`GITHUB_TOKEN` is automatic — no secret needed for GHCR.

---

## 🚀 Deployment — Scripts Ready, Awaiting Server

All deployment artefacts have been written. You still need to:
1. Create the DigitalOcean Droplet
2. Run the scripts below on it

### Files created
- [x] `deploy/server-setup.sh`         — one-time server bootstrap (installs everything, creates DB, writes .env)
- [x] `deploy/nginx.conf`              — Nginx reverse-proxy config (replace `api.yourdomain.com`)
- [x] `deploy/backup.sh`              — nightly pg_dump with 7-day retention
- [x] `deploy/deploy.sh`              — zero-downtime redeploy (git pull → migrate → pm2 reload)
- [x] `backend/ecosystem.config.js`   — PM2 cluster config
- [x] `backend/.env.production.example` — production .env template (fill in secrets)
- [x] `frontend/.env.production`      — sets `VITE_API_URL` for Netlify build
- [x] `admin/.env.production`         — sets `VITE_API_URL` for Netlify admin build
- [x] `frontend/netlify.toml`         — Netlify build + SPA redirect rule
- [x] `admin/netlify.toml`            — Netlify build + SPA redirect rule
- [x] `.gitignore`                    — protects .env secrets from being committed

### Steps still needed (on the server)

#### Server (DigitalOcean)
- [ ] Create Droplet ($6/month, Ubuntu 22.04)
- [ ] SSH in: `ssh root@YOUR_SERVER_IP`
- [ ] Run: `bash deploy/server-setup.sh` (does everything: Node, Postgres, PM2, Nginx, DB, migrations, .env, PM2 start)

#### Nginx + SSL
- [ ] Copy and edit `deploy/nginx.conf` → `/etc/nginx/sites-available/cosmetics` (update domain)
- [ ] `ln -s /etc/nginx/sites-available/cosmetics /etc/nginx/sites-enabled/`
- [ ] `certbot --nginx -d api.yourdomain.com`

#### Frontend + Admin (Netlify)
- [ ] Push repo to GitHub (`.gitignore` now in place)
- [ ] Connect frontend folder to a new Netlify site (base dir: `frontend`)
- [ ] Connect admin folder to a second Netlify site (base dir: `admin`)
- [ ] Set custom domains in Netlify dashboard

#### Paystack
- [ ] Switch from test keys to live keys in production `.env`
- [ ] Register webhook in Paystack dashboard: `https://api.yourdomain.com/api/payments/webhook`

#### Backups
- [ ] `scp deploy/backup.sh deploy@server:/home/deploy/backup.sh`
- [ ] `chmod +x /home/deploy/backup.sh`
- [ ] Add cron: `0 2 * * * /home/deploy/backup.sh >> /home/deploy/app/logs/backup.log 2>&1`

---

## Notes

- Backend runs locally on `http://localhost:3000` (nodemon, dev mode)
- Frontend dev server: `frontend/` → `npm run dev` (Vite, port 5173)
- Admin dev server: `admin/` → `npm run dev` (Vite, port 5174 or similar)
- DB: PostgreSQL local, DB name `cosmetics_db`, user `postgres`
- Paystack: currently on **test keys** — swap to live keys before real transactions
- SMTP: configured for Gmail — needs a real App Password in `.env`

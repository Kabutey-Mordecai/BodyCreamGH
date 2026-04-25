# What We Built — Cosmetics GH Platform

A complete production-ready e-commerce platform for a Ghana cosmetics business. Three separate
applications share one PostgreSQL database through a single REST API backend.

```
backend/     Node.js + Express REST API  →  runs on your server (VPS / Docker)
frontend/    React storefront            →  deploys to Netlify (customer-facing shop)
admin/       React dashboard             →  deploys to Netlify (staff-only management)
```

---

## 1. Backend API (`backend/`)

**Technology:** Node.js 20, Express 4, PostgreSQL 15 (raw SQL — no ORM), JWT auth, pg-boss job queue, Winston logging.

The backend is the single source of truth. Every piece of data — products, orders, payments, users — goes through here. The frontend and admin are just UI layers on top.

### Entry point

`backend/src/server.js` — starts Express, registers all middleware and routes, initialises the database pool, boots pg-boss workers, and exposes `GET /api/health` for Docker/load-balancer health checks.

---

### Database (`backend/migrations/`)

Migrations are plain SQL files run in filename order by `migrations/run.js`. The runner is **idempotent** — it tracks which files have already been applied in a `schema_migrations` table, so running `npm run migrate` twice is safe.

| Migration file | What it creates |
|---|---|
| `001_create_tables.sql` | Core tables: `users`, `products`, `cart`, `cart_items`, `orders`, `order_items`, `payments`, `inventory_history` |
| `002_auth_tokens.sql` | `refresh_tokens` table for server-side JWT rotation |
| `002_site_settings.sql` | `site_settings` key-value table (storefront config, theme colours) |
| `003_reviews.sql` | `product_reviews` table (rating, title, body, verified-purchase flag) |
| `004_wishlists.sql` | `wishlists` table (user ↔ product many-to-many) |
| `005_tracking_system.sql` | `deliveries` table (tracking number, courier, status), `order_status_log` (audit trail) |
| `006_coupons.sql` | `coupons` table (percentage/fixed discount, min-order, max-uses, expiry) |
| `007_production_hardening.sql` | `processed_events` table (Paystack webhook idempotency), composite performance indexes |
| `008_guest_email_column.sql` | `guest_email` column on `orders` so non-registered shoppers get email receipts |

Also included: `migrations/seed.js` — populates sample products and an admin user for local development.

---

### Configuration (`backend/src/config/`)

| File | Purpose |
|---|---|
| `database.js` | Creates and exports the `pg.Pool` connection. Reads `DB_*` env vars. |
| `paystack.js` | Exports an axios instance pre-configured with the Paystack base URL and `Authorization: Bearer <PAYSTACK_SECRET_KEY>` header. |
| `pgboss.js` | Initialises and exports the pg-boss job queue instance. pg-boss stores its own job tables inside the same PostgreSQL database so there's no need for a separate Redis instance. |

---

### Routes and Controllers

Each route file maps a URL prefix to a controller. Controllers contain the business logic; they never touch the database directly — that goes through the model layer.

#### Auth (`/api/auth`) — `routes/auth.js` + `controllers/auth.controller.js`

| Endpoint | What it does |
|---|---|
| `POST /register` | Creates a new user with a bcrypt-hashed password. Returns access + refresh tokens. |
| `POST /login` | Verifies credentials, issues a 15-minute JWT access token and a 7-day refresh token (stored server-side in `refresh_tokens`). |
| `POST /refresh` | Accepts a refresh token, rotates it (old token invalidated, new one issued). Used by the frontend interceptor to silently re-authenticate. |
| `POST /logout` | Deletes the refresh token from the database — immediate session termination even if the access token hasn't expired yet. |
| `POST /forgot-password` | Generates a time-limited reset token, emails a link to the user. |
| `POST /reset-password` | Validates the reset token, updates the hashed password. |
| `GET /profile` | Returns the authenticated user's profile. |
| `PUT /profile` | Updates name, phone, address fields. |

#### Products (`/api/products`) — `routes/products.js` + `controllers/product.controller.js`

| Endpoint | What it does |
|---|---|
| `GET /` | Lists all products with optional `?category=`, `?search=`, `?page=`, `?limit=` query params. |
| `GET /:id` | Returns a single product including average rating and review count. |
| `POST /` | Admin-only. Creates a product with name, description, price, category, image URL, initial stock quantity. |
| `PUT /:id` | Admin-only. Updates any product field. |
| `DELETE /:id` | Admin-only. Soft-deletes (sets `active = false`) so order history still references the product. |

#### Cart (`/api/cart`) — `routes/cart.js` + `controllers/cart.controller.js`

Cart is **session-based for guests** and **user-linked for logged-in customers**. Items are stored in `cart` + `cart_items` tables, not localStorage, so the cart survives browser refreshes and can be merged if a guest logs in.

| Endpoint | What it does |
|---|---|
| `GET /` | Returns all items in the current cart with product details. |
| `POST /add` | Adds a product (or increments quantity if already present). Checks stock before adding. |
| `PUT /update` | Changes quantity of a specific cart item. |
| `DELETE /remove/:productId` | Removes one product from the cart. |
| `DELETE /clear` | Empties the entire cart (called automatically after successful checkout). |

#### Orders (`/api/orders`) — `routes/orders.js` + `controllers/order.controller.js`

Orders move through a strict state machine: `pending → confirmed → processing → shipped → delivered`. Invalid transitions (e.g. jumping from `pending` to `delivered`) are rejected.

| Endpoint | What it does |
|---|---|
| `POST /` | Creates an order for an authenticated user. Validates the cart items still exist and are in stock, calculates the total, optionally applies a coupon (with `SELECT FOR UPDATE` lock to prevent race conditions), and inserts the order + items in a single transaction. |
| `POST /guest` | Same as above but for anonymous shoppers. Accepts `guest_email` so confirmation emails can be sent without an account. |
| `GET /my-orders` | Returns all orders belonging to the authenticated user. |
| `GET /:id` | Returns a single order including items, payment status, and delivery tracking. |
| `GET /` | Admin-only. Returns all orders with optional status filter and pagination. |
| `PATCH /:id/status` | Admin-only. Advances the order status (validates transition via state machine). |

#### Payments (`/api/payments`) — `routes/payments.js` + `controllers/payment.controller.js`

| Endpoint | What it does |
|---|---|
| `POST /initialize` | Calls Paystack's API to create a payment session. Returns an `authorization_url` that the frontend redirects to. |
| `POST /initialize-guest` | Same for guest orders. Verifies the provided email matches `orders.guest_email` to prevent unauthorised payment. |
| `POST /webhook` | Receives Paystack's signed webhook event. Verifies the HMAC-SHA512 signature, checks idempotency via the `processed_events` table (prevents double-processing on retries), then enqueues a `payment-success` pg-boss job. |
| `GET /verify/:reference` | Manual verification fallback — used by the frontend's payment callback page to confirm status if the webhook hasn't fired yet. |

#### Inventory (`/api/inventory`) — `routes/inventory.js` + `controllers/inventory.controller.js`

| Endpoint | What it does |
|---|---|
| `GET /` | Lists all products with current stock levels. |
| `POST /adjust` | Admin-only. Increases or decreases stock for a product, recording the reason in `inventory_history`. |
| `GET /history/:productId` | Returns the full stock adjustment history for a product. |

#### Deliveries (`/api/deliveries`) — `routes/deliveries.js` + `controllers/delivery.controller.js`

| Endpoint | What it does |
|---|---|
| `POST /` | Admin-only. Creates a delivery record for an order (assigns courier, tracking number, estimated date). Enqueues a `create-shipment` pg-boss job which also updates the order status to `processing`. |
| `PATCH /:id/status` | Updates delivery status (`in_transit → out_for_delivery → delivered`). When `delivered` is set, enqueues `order-delivered` job which marks the order complete and sends a review-request email. |
| `GET /order/:orderId` | Returns delivery details for a given order. |

#### Coupons (`/api/coupons`) — `routes/coupons.js` + `controllers/coupon.controller.js`

| Endpoint | What it does |
|---|---|
| `POST /` | Admin-only. Creates a coupon with code, type (`percentage`/`fixed`), value, optional min order amount, max uses, and expiry date. |
| `GET /` | Admin-only. Lists all coupons with use counts and status. |
| `POST /validate` | Public. Validates a coupon code against an order total — returns the discount amount without applying it (used for the checkout preview). |
| `PATCH /:id/deactivate` | Admin-only. Disables a coupon immediately. |
| `DELETE /:id` | Admin-only. Permanently deletes a coupon. |

The `validateAndLock` method in `coupon.model.js` runs inside the order creation transaction with `SELECT ... FOR UPDATE` — this prevents two simultaneous checkouts from both seeing `uses_count < max_uses` and both incrementing past the limit.

#### Reviews (`/api/products/:id/reviews`) — `controllers/review.controller.js`

| Endpoint | What it does |
|---|---|
| `GET /` | Returns all approved reviews for a product. |
| `POST /` | Authenticated users only. Submits a review. One review per user per product enforced at DB level. |
| `GET /status` | Returns whether the current user has already reviewed this product (used to show form vs. thank-you message). |
| `DELETE /:reviewId` | Admin-only. Removes a review. |

#### Wishlist (`/api/wishlist`) — `routes/wishlist.js` + `controllers/wishlist.controller.js`

| Endpoint | What it does |
|---|---|
| `GET /` | Returns the authenticated user's wishlist. |
| `POST /` | Adds a product to the wishlist. |
| `DELETE /:productId` | Removes a product from the wishlist. |

#### Admin (`/api/admin`) — `routes/admin.js` + `controllers/admin.controller.js`

Admin-only analytics and management endpoints.

| Endpoint | What it does |
|---|---|
| `GET /dashboard` | Returns revenue totals, order counts by status, customer count, low-stock products, and the 10 most recent orders — all in one query batch. |
| `GET /analytics` | Returns daily/weekly/monthly revenue and order volume for chart rendering. |
| `GET /top-products` | Top-selling products by revenue. |
| `GET /customers` | Paginated customer list. |
| `GET /customers/:id` | Single customer profile with full order history. |

#### Settings (`/api/settings`) — `routes/settings.js` + `controllers/settings.controller.js`

| Endpoint | What it does |
|---|---|
| `GET /` | Returns all site settings (hero text, announcement bar, theme colours, delivery fees). |
| `PUT /` | Admin-only. Updates one or more settings keys. |

---

### Models (`backend/src/models/`)

Models encapsulate all SQL queries. Controllers call models; models call the database. This keeps SQL out of route handlers and makes queries easy to reuse.

| Model | Key methods |
|---|---|
| `user.model.js` | `findByEmail`, `create`, `findById`, `update`, `updatePassword` |
| `product.model.js` | `findAll` (with filters), `findById`, `create`, `update`, `softDelete` |
| `order.model.js` | `create` (transactional), `findById`, `findByUser`, `findAll`, `updateStatus`, `updatePaymentStatus` |
| `coupon.model.js` | `findByCode`, `validate` (pre-flight check), `validateAndLock` (transactional, FOR UPDATE), `incrementUses` |
| `delivery.model.js` | `create`, `findByOrder`, `updateStatus` |
| `inventory.model.js` | `findAll`, `adjust` (transactional stock update + history insert), `getHistory` |
| `review.model.js` | `findByProduct`, `create`, `findByUserAndProduct`, `delete` |
| `wishlist.model.js` | `findByUser`, `add`, `remove` |
| `customer.model.js` | `findAll`, `findById` (with order history) |

---

### Middleware (`backend/src/middleware/`)

| File | What it does |
|---|---|
| `auth.js` | `authenticate` — verifies the `Authorization: Bearer <token>` JWT on protected routes. `requireAdmin` — additionally checks `user.role === 'admin'`. |
| `validation.js` | Joi schemas for every request body. `stripUnknown: true` removes unexpected fields. `abortEarly: false` returns all validation errors at once. Includes `coupon_code` in order schemas so it isn't silently dropped. |
| `errorHandler.js` | Global Express error handler. Returns `err.message` for 4xx errors (safe to show users) and a generic `'Internal server error'` for 5xx (hides implementation details). |
| `rateLimit.js` | In-memory rate limiter. Defaults to 100 requests per 15-minute window per IP. Stricter limits on auth endpoints. |

---

### Async Workers (`backend/src/workers/`)

Workers are pg-boss job consumers. pg-boss persists jobs in PostgreSQL so they survive server restarts. Each worker:
1. Picks up a job by name from the queue
2. Opens a database transaction
3. Does its work
4. Commits or rolls back
5. Throws on failure so pg-boss automatically retries with exponential backoff

| Worker | Job name | What it does |
|---|---|---|
| `payment.worker.js` | `payment-success` | Marks `payment_status = 'paid'`. If the order is still `pending`, also advances it to `confirmed`. Guards against orders that were cancelled after payment was initiated. |
| `shipment.worker.js` | `create-shipment` | Creates the `deliveries` row. Advances order to `processing` if it isn't already (idempotent — safe to retry). |
| `shipment.worker.js` | `order-delivered` | Marks order `delivered`. Does NOT use the state machine assertion here — automated courier path skips the `shipped` step and goes directly `processing → delivered`. |
| `notification.worker.js` | `payment-success` | Sends order confirmation email. Uses `COALESCE(u.email, o.guest_email)` so guest orders get the email too. |
| `notification.worker.js` | `shipment-created` | Sends shipping notification email with tracking details. |
| `notification.worker.js` | `order-delivered` | Sends delivery confirmation + review-request email. |
| `reconciliation.worker.js` | `reconcile-payment` | Scheduled job that checks for orders stuck in `pending` with a Paystack reference — re-verifies with Paystack and marks paid if the payment went through but the webhook was missed. |

---

### Event System (`backend/src/events/`)

A secondary event bus (`events/eventBus.js`) using Node's built-in `EventEmitter`. This is the **legacy path** — it was the original async mechanism before pg-boss was added. Both systems currently run in parallel.

`events/index.js` wires up handlers and wraps each one in a `safe()` function that catches async errors and logs them instead of creating unhandled Promise rejections.

| Event | Handler | What it does |
|---|---|---|
| `payment.success` | `payment.handler.js` | Updates order status, reduces inventory for each item. |
| `shipment.delivered` | `shipment.handler.js` | Marks the order delivered, triggers a review-request email. |

---

### Services (`backend/src/services/`)

| Service | What it does |
|---|---|
| `email.service.js` | Nodemailer wrapper (Gmail SMTP). Methods: `sendOrderConfirmation`, `sendShippingNotification`, `sendDeliveryConfirmation`, `sendPasswordReset`, `sendReviewRequest`. All render HTML email bodies with inline styles (no template engine dependency). |
| `courier.service.js` | Stub for courier API integration (Ghana Post / DHL). Currently generates tracking numbers locally. Replace the internals with real courier API calls when you have a contract. |
| `notification.service.js` | Thin wrapper that decides whether to send via email or another channel in the future (SMS, push). |

---

### Utilities (`backend/src/utils/`)

| File | What it does |
|---|---|
| `logger.js` | Winston logger. In production: JSON format to stdout (Docker-friendly, picked up by log aggregators). In development: coloured human-readable output. |
| `stateMachine.js` | `assertTransition(from, to)` — throws if the requested order status transition isn't in the allowed map. Keeps state transition rules in one place. |
| `idempotency.js` | `markProcessed(eventId, client)` — inserts into `processed_events` inside the caller's transaction. If the row already exists (duplicate webhook), the insert throws a unique constraint error which the caller catches and ignores. |
| `helpers.js` | Small utility functions: `generateOrderNumber`, `generateToken`, `hashPassword`, `comparePassword`. |

---

## 2. Customer Storefront (`frontend/`)

**Technology:** React 18, Vite, React Router v6, Axios, Context API.

The storefront is a Single Page Application. All pages are client-side rendered. Vite builds it to a static `dist/` folder that deploys to Netlify in under 2 minutes.

### Context providers (global state)

| Context | What it manages |
|---|---|
| `AuthContext.jsx` | Logged-in user, access token, refresh token interceptor (Axios interceptor auto-retries on 401 using the pending-queue pattern — no duplicate refresh calls). |
| `CartContext.jsx` | Cart items array, add/remove/update/clear, item count badge. Cart is stored client-side; cleared from the server after checkout. |
| `SettingsContext.jsx` | Site settings loaded from `GET /api/settings` on mount — hero text, announcement bar content, theme colour overrides. |
| `WishlistContext.jsx` | Wishlist items, add/remove, synced with the server when the user is logged in. |

### Pages

| Page | Route | What it does |
|---|---|---|
| `Home.jsx` | `/` | Hero banner (text from Settings), announcement bar, featured products grid, trust strip (payment icons). |
| `Shop.jsx` | `/shop` | Product listing with category filter chips and live search. Infinite scroll / pagination. |
| `ProductPage.jsx` | `/product/:id` | Product image, description, price, stock status, quantity picker, add-to-cart. Star rating summary. Reviews list with submit form (only shown after a verified purchase and only if not already reviewed). |
| `Cart.jsx` | `/cart` | Line items, quantity controls, subtotal, delivery fee (fetched from Settings), coupon code input with server-side validation. |
| `Checkout.jsx` | `/checkout` | Delivery address and phone form. Order summary. Region-based delivery fee. Calls `POST /api/orders` then `POST /api/payments/initialize` and redirects to Paystack. |
| `PaymentCallback.jsx` | `/payment/callback` | Landing page after Paystack redirect. Calls `GET /api/payments/verify/:reference`, shows success or failure, redirects to Order Detail. |
| `Orders.jsx` | `/orders` | Order list grouped by date (Today / Yesterday / This Week / Month Year). Shows status badges. |
| `OrderDetail.jsx` | `/orders/:id` | Order items, prices, status timeline, delivery tracking info. |
| `Account.jsx` | `/account` | Profile form (name, phone, address), password change form. |
| `Login.jsx` | `/login` | Email + password form. Links to Register and Forgot Password. |
| `Register.jsx` | `/register` | Name, email, phone, password. Auto-logs in on success. |
| `ForgotPassword.jsx` | `/forgot-password` | Sends reset link to email. |
| `ResetPassword.jsx` | `/reset-password` | Token-based password reset (link from email). |
| `Wishlist.jsx` | `/wishlist` | Shows wishlist items. Add-to-cart button per item. |

### Components

| Component | What it does |
|---|---|
| `Navigation.jsx` | Top nav bar: logo, shop link, cart icon with item count badge, account link, wishlist. Collapses to hamburger on mobile. |
| `AnnouncementBar.jsx` | Full-width banner above the nav. Text comes from `SettingsContext`. Hidden when announcement is empty. |
| `Footer.jsx` | Links, contact info, social icons. |
| `ProductCard.jsx` | Used in Home and Shop grids. Shows image, name, price, rating, add-to-cart button. |
| `StarRating.jsx` | Renders ★★★☆☆ from a decimal average. Also used as an input for submitting reviews. |
| `TrustStrip.jsx` | Row of payment method icons + free delivery threshold message. |
| `ProtectedRoute.jsx` | Wraps any route that requires login. Redirects to `/login` if the user is not authenticated. |

---

## 3. Admin Dashboard (`admin/`)

**Technology:** React 18, Vite, React Router v6, Axios, Context API.

The admin dashboard is a completely separate React app at a different URL. Only users with `role = 'admin'` can use it — every API call goes through the same `requireAdmin` middleware on the backend.

### Context

| Context | What it manages |
|---|---|
| `AuthContext.jsx` | Admin login state, access token, refresh interceptor (same pending-queue pattern as the storefront). |
| `ToastContext.jsx` | Global toast notification queue (success / error messages). |

### Pages

| Page | What it does |
|---|---|
| `Dashboard.jsx` | Revenue KPI cards (today / this week / this month), orders by status breakdown, low-stock alerts, recent orders table with payment status column. Auto-refreshes every 30 seconds. Shows "Updated HH:MM" timestamp. |
| `Products.jsx` | Product list with search. Edit and delete buttons per row. Link to ProductEditor. |
| `ProductEditor.jsx` | Create or edit a product. Image URL, price, category, description, stock quantity fields. |
| `Orders.jsx` | All orders table with status filter, search, 30-second auto-poll, and manual refresh button. |
| `OrderDetail.jsx` | Full order view: customer info, items, payment status. Status change dropdown (validates allowed transitions). Admin note field. Status timeline / audit log. Print invoice button. |
| `Customers.jsx` | Paginated customer list with search. |
| `CustomerDetail.jsx` | Single customer profile with contact details and their complete order history. |
| `Inventory.jsx` | Products with current stock levels. Adjust stock form (increase/decrease + reason). |
| `Analytics.jsx` | Line charts for daily revenue and order volume. Top-selling products by revenue. Date range selector. |
| `Coupons.jsx` | Create coupon form with auto-generate code button. Lists all coupons with use-count progress, status badge (active / expired / depleted). Deactivate and delete actions. |
| `Reviews.jsx` | All submitted reviews with rating, product name, customer name, date. Delete button for moderation. |
| `Storefront.jsx` | Storefront Editor — edit hero headline, hero subtext, featured product IDs, announcement bar message. Saved to `site_settings` table. |
| `Theme.jsx` | Theme Customizer — pick brand colours (primary, accent, background, text). Generates CSS variable overrides saved to `site_settings`. Live preview. |
| `Settings.jsx` | Store settings: store name, contact email, delivery fees per region, free delivery threshold. |

---

## 4. Infrastructure & DevOps

### Docker (`backend/Dockerfile`, `docker-compose.yml`, `docker-compose.prod.yml`)

Two separate Docker setups — one for local development, one for production.

**Development (`docker-compose.yml`)**
- `postgres:15-alpine` with port 5432 exposed (so you can connect with pgAdmin).
- Backend built from `Dockerfile.dev` — uses `nodemon` for hot reload. Source directory is mounted as a volume so code changes take effect immediately without rebuilding the image.
- A named `postgres_dev_data` volume keeps data between `docker-compose down` restarts.

```bash
docker-compose up           # starts db + backend
docker-compose up db        # starts only the database (run backend natively)
docker-compose exec backend npm run migrate
```

**Production (`docker-compose.prod.yml`)**
- PostgreSQL with no exposed ports — only the backend container can reach it.
- Backend built from `Dockerfile` (multi-stage):
  - Stage 1 (`deps`): `npm ci --omit=dev` — production deps only, no nodemon.
  - Stage 2 (`runner`): copies deps and source into a minimal Alpine image. Runs as non-root user `nodejs` (UID 1001). Built-in Docker HEALTHCHECK (`wget /api/health`).
- Nginx (`nginx:alpine`) sits in front, handles SSL termination, forwards `/api/*` to the backend container. Let's Encrypt certificates are mounted from the host.

```bash
docker-compose -f docker-compose.prod.yml up -d --build
docker-compose -f docker-compose.prod.yml exec backend npm run migrate
# Zero-downtime redeploy (only restarts backend, db and nginx stay up):
docker-compose -f docker-compose.prod.yml up -d --no-deps backend
```

---

### GitHub Actions CI/CD (`.github/workflows/`)

**CI (`ci.yml`)** — runs on every push and pull request to `main`.

Three parallel jobs:
1. **backend** — `npm ci`, `node --check` on every `.js` file under `src/` and `migrations/`, `npm audit --audit-level=high` (fails build on high/critical CVEs in production deps).
2. **frontend** — `npm ci`, `npm run build` with a placeholder `VITE_API_URL`. Uploads the built `dist/` as a workflow artifact.
3. **admin** — same as frontend.

A `concurrency` group cancels stale in-progress runs when new commits are pushed rapidly.

**Deploy (`deploy.yml`)** — runs on push to `main` that touches backend or Docker files.

1. Logs into GitHub Container Registry (GHCR) using the automatic `GITHUB_TOKEN` — no manual secret needed.
2. Builds the production Docker image using `docker/build-push-action` with registry-side layer caching (cache key stored in GHCR itself — any runner can reuse it).
3. Tags the image with `sha-<short-git-sha>` and `latest`.
4. SSHes into the server and runs: `git pull → docker pull → docker-compose up --no-deps backend → npm run migrate → docker image prune`.

Required secrets in GitHub → Settings → Secrets → Actions:

| Secret | Description |
|---|---|
| `DEPLOY_HOST` | Server IP or hostname |
| `DEPLOY_USER` | SSH username (e.g. `deploy`) |
| `DEPLOY_SSH_KEY` | Full contents of the private key (`~/.ssh/id_ed25519`) |
| `DEPLOY_PORT` | SSH port (usually `22`) |

---

### Server Deployment Scripts (`deploy/`)

For a direct VPS setup (without Docker), run the scripts in this folder.

| Script / File | What it does |
|---|---|
| `server-setup.sh` | One-time interactive bootstrap. Installs Node 20, PostgreSQL 15, PM2, Nginx, Certbot. Creates a non-root `deploy` user. Creates the database and DB user. Clones the repo. Runs `npm install --omit=dev`. Prompts for all secrets and writes the production `.env` file. Runs migrations. Starts the app with PM2. |
| `deploy.sh` | Zero-downtime redeploy script. Run after `git push`: `git fetch → git reset --hard origin/main → npm install --omit=dev → npm run migrate → pm2 reload ecosystem.config.js --update-env`. |
| `nginx.conf` | Nginx config. HTTP → HTTPS redirect. HTTPS server block with SSL certificate paths (Certbot fills these in). Security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy). Proxy `/api/*` to `127.0.0.1:3000`. Blocks access to dot-files. |
| `backup.sh` | `pg_dump | gzip` to a timestamped file. Deletes backups older than 7 days. Add to cron for nightly automated backups. |

`backend/ecosystem.config.js` — PM2 process config: cluster mode with one process per CPU core, 500 MB memory cap with auto-restart, and structured log paths.

---

### Environment Files

| File | Purpose |
|---|---|
| `backend/.env.production.example` | Template with every environment variable documented. Copy to `.env` and fill in real values before deploying. Never commit the real `.env`. |
| `frontend/.env.production` | Sets `VITE_API_URL=https://api.yourdomain.com/api` for the Netlify production build. |
| `admin/.env.production` | Same for the admin app. |
| `frontend/netlify.toml` | Tells Netlify: build command is `npm run build`, publish directory is `dist`, and all routes fall back to `index.html` (required for client-side routing). |
| `admin/netlify.toml` | Same for the admin app. |
| `.gitignore` | Excludes `.env` files, `node_modules/`, `dist/`, `logs/`, `.pm2/`. The `.env.production` files (no secrets, just the API URL) are intentionally committed and tracked. |

---

## 5. Key Design Decisions

### Why raw SQL instead of an ORM?

Raw SQL (via the `pg` library) gives complete control over queries, makes it obvious exactly what hits the database, and avoids ORM magic that can cause N+1 queries or unexpected joins. For a project this size it's more maintainable than learning an ORM's quirks.

### Why pg-boss instead of Redis/BullMQ?

pg-boss stores jobs in the same PostgreSQL database — no extra infrastructure (Redis server, connection, separate backups). For a Ghana-market e-commerce site processing hundreds of orders per day (not millions), PostgreSQL's performance is more than sufficient for job queuing.

### Coupon race condition prevention

Without a database lock, two users submitting checkout at the same millisecond could both see `uses_count < max_uses` and both succeed, exceeding the limit. The `coupon.model.js → validateAndLock()` method runs inside the same transaction as order creation and uses `SELECT ... FOR UPDATE` — the second concurrent request blocks until the first transaction commits, then reads the updated `uses_count` and correctly rejects if the limit is hit.

### Idempotent webhook processing

Paystack retries webhook delivery if your server doesn't respond with 200 within a few seconds. Without protection this causes double-processing: an order getting confirmed twice, inventory decremented twice, two confirmation emails. The `processed_events` table has a unique constraint on `event_id`. The first webhook inserts the row and proceeds. Any retry hits the unique constraint, throws, and is caught — no double processing.

### Guest checkout + email notifications

Registered users have their email in the `users` table. Guest orders store the email in `orders.guest_email` (added in migration 008). All three notification workers use `COALESCE(u.email, o.guest_email)` in their queries so guest shoppers receive the same confirmation, shipping, and delivery emails as registered customers.

### JWT access + refresh token strategy

Access tokens are short-lived (15 minutes) to limit the damage if one is stolen — a stolen access token stops working on its own in 15 minutes. Refresh tokens live in the database (7 days). Logging out deletes the refresh token from the database, which is immediate revocation — the user cannot get a new access token even if their old access token hasn't expired yet. The frontend uses a pending-queue pattern in the Axios interceptor: if multiple requests fire simultaneously after token expiry, only one refresh call is made, and the others wait for it to resolve.

---

## 6. Running Everything Locally

```bash
# 1. Clone and install
git clone <repo>
cd backend && npm install
cd ../frontend && npm install
cd ../admin && npm install

# 2. Start the database (Docker)
cd ..
docker-compose up db

# 3. Create backend/.env from the example
cp backend/.env.production.example backend/.env
# Edit backend/.env — set DB_HOST=localhost, DB_USER=postgres, DB_PASSWORD=mord123
# Add your PAYSTACK_SECRET_KEY (test key), JWT_SECRET, SMTP credentials

# 4. Run migrations
cd backend && npm run migrate

# 5. Seed sample data (optional)
node migrations/seed.js

# 6. Start all three servers (in separate terminals)
cd backend  && npm run dev   # http://localhost:3000
cd frontend && npm run dev   # http://localhost:5173
cd admin    && npm run dev   # http://localhost:5174
```

---

## 7. Deploying to Production

### Option A — Docker on any VPS

```bash
# On the server (first time)
git clone <repo> ~/app && cd ~/app
cp backend/.env.production.example backend/.env
# Fill in backend/.env with real secrets
docker-compose -f docker-compose.prod.yml up -d --build
docker-compose -f docker-compose.prod.yml exec backend npm run migrate

# On every push after that — GitHub Actions does this automatically:
docker-compose -f docker-compose.prod.yml pull backend
docker-compose -f docker-compose.prod.yml up -d --no-deps backend
docker-compose -f docker-compose.prod.yml exec -T backend npm run migrate
```

### Option B — PM2 on a VPS (no Docker)

```bash
# First time
bash deploy/server-setup.sh   # interactive — prompts for all secrets

# Every redeploy
bash deploy/deploy.sh
```

### Frontend + Admin (Netlify — free tier)

1. Push the repo to GitHub.
2. In Netlify: New Site → Import from Git → select the repo.
3. Set **Base directory** to `frontend`, build command `npm run build`, publish `dist`.
4. Add environment variable `VITE_API_URL=https://api.yourdomain.com/api`.
5. Repeat for `admin` as a second Netlify site.

### Paystack webhook

In the Paystack dashboard: Developers → Webhooks → add `https://api.yourdomain.com/api/payments/webhook`.

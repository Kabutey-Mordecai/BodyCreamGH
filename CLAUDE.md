# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repository Is

This is a **blueprint and reference guide** for building a production-ready cosmetics e-commerce platform targeting the Ghana market. It is not yet a runnable codebase — the files here are comprehensive documentation and code examples to guide implementation.

## Documents in This Repo

| File | Purpose |
|---|---|
| `COSMETICS_BUILD_GUIDE.md` | Complete hard-coded implementation reference: backend API, DB schema, auth, payments, frontend, admin dashboard, mobile app, and DigitalOcean deployment |
| `COMPLETE_PACKAGE_SUMMARY.md` | Overview of the learning roadmap, revenue model, and how to use the guides |

## Intended Platform Architecture

The platform to be built has four distinct applications that share a single PostgreSQL database via the backend API:

```
backend/     → Node.js + Express REST API (source of truth)
frontend/    → React web storefront
admin/       → React admin dashboard
migrations/  → PostgreSQL DDL scripts
```

**Backend entry point:** `backend/src/server.js`  
**Frontend entry point:** `frontend/src/index.js`  
**Mobile entry point:** `mobile/lib/main.dart`

## Tech Stack

- **Backend:** Node.js + Express, PostgreSQL (`pg` library, raw SQL — no ORM), JWT auth, bcryptjs
- **Payments:** Paystack (Ghana-specific; ~1.5% transaction fee vs Shopify's 2.5%)
- **Frontend/Admin:** React with Context API for state, axios for API calls
- **Hosting:** DigitalOcean Droplet ($5-20/month) for backend + Netlify (free) for frontend
- **Process manager:** PM2 for Node.js in production; Nginx as reverse proxy with SSL

## Backend Structure

Routes map directly to business domains:

| Route | Responsibility |
|---|---|
| `auth.js` | Register, login, JWT issuance, password reset |
| `products.js` | Product CRUD with SKUs and pricing |
| `cart.js` | Session-based cart management |
| `orders.js` | Order lifecycle and status tracking |
| `payments.js` | Paystack webhook handling and verification |
| `inventory.js` | Stock levels and inventory history |
| `analytics.js` | Sales reports and admin metrics |
| `admin.js` | Admin-only endpoints (role checked via JWT middleware) |

Middleware layer: `auth.js` (JWT verification), `validation.js`, `errorHandler.js`.

## Database Schema (Key Tables)

`users` → `orders` → `order_items` → `products`  
`users` → `cart` → `products`  
`orders` → `payments`  
`orders` → `deliveries`  
`products` → `inventory_history`

## Environment Variables

When building, the `.env` file (see `.env.example` in the guide) must contain:
- `PORT`, `NODE_ENV`
- `DATABASE_URL` or individual `DB_*` fields
- `JWT_SECRET`, `JWT_EXPIRE`
- `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`
- SMTP config for email notifications

## Commands (Once Built)

```bash
# Backend
npm run dev          # nodemon src/server.js (development)
npm start            # node src/server.js (production)
npm run migrate      # node migrations/run.js

# Frontend / Admin
npm start            # React dev server
npm run build        # Production build → deploy to Netlify

# Mobile
flutter run          # Run on device/emulator
flutter build apk    # Android release build
```

## Key Business Context

- Target market: Ghana cosmetics businesses switching from Shopify
- Cost advantage: ~$25-50/month vs ₵1,260+/year Shopify fees plus 2.5% per transaction
- Revenue model: one-time build fee (₵8,000-18,000) + 5% commission on sales + optional ad revenue
- Paystack is the only supported payment provider (handles GHS currency natively)

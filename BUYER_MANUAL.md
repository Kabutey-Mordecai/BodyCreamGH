# BodyCream GH — Commercial Handover & Buyer Operations Manual
**Turnkey Full-Stack Omnichannel E-Commerce Suite for the African Beauty & Retail Market**  
**Version:** 2.0 Production-Ready (November 2026)

---

## 1. Executive Summary

BodyCream GH is a high-performance, production-grade e-commerce ecosystem built from the ground up without subscription-based SaaS dependencies (e.g. Shopify apps or WooCommerce extensions). It offers 100% source code ownership and is tailored for the Ghanaian and West African retail cosmetics and beauty market with native Mobile Money (MTN, Telecel, AT), Paystack card processing, Cash on Delivery (COD), and WhatsApp direct ordering.

### Included Systems
1. **Customer Web Storefront (`/frontend`):** Built with React 19, Vite, React Router v7, dual-thumb price sliders, brand facet counts, offline-synced cart, and accessible native `<dialog>` customer photo review gallery.
2. **Multi-Role Admin ERP Dashboard (`/admin`):** Built with React, Vite, 4-tier Role-Based Access Control (`super_admin`, `admin`, `inventory_manager`, `support`), inventory threshold tracking, printable A4/80mm barcode dispatch waybills, and 1-click WhatsApp/email abandoned cart recovery with automated discount coupons.
3. **Core REST API & Worker (`/backend`):** Built with Node.js, Express, PostgreSQL 15, `pg-boss` background worker queues, transactional email (Nodemailer), local Ghana SMS gateway (Arkesel/Hubtel/mNotify), and Firebase Cloud Messaging (FCM) push notifications.
4. **Cross-Platform Mobile App (`/mobile`):** Built with Flutter 3.24+, Provider state management, GoRouter, secure encrypted token storage, cached network images, offline cart persistence, review photo viewer, and native Android/iOS compilation.

---

## 2. 5-Minute Quickstart

### Option A: 1-Command Docker Launch (Recommended for Evaluation)
Ensure [Docker Desktop](https://www.docker.com/products/docker-desktop/) is running on your machine:

```bash
# Clone the repository and navigate into it
cd BodyCreamGH

# Launch Database, Backend API, Storefront Web, and Admin Dashboard
docker-compose up --build
```

**Live URLs:**
- **Storefront Web App:** `http://localhost:3000`
- **Admin ERP Dashboard:** `http://localhost:3001`
- **Backend REST API:** `http://localhost:5000/api`
- **PostgreSQL Database:** `localhost:5432` (Database: `cosmetics_db`, User: `postgres`, Password: `mord123`)

---

### Option B: Native Development Setup

#### Prerequisites
- Node.js 20+ & npm
- PostgreSQL 15+ running locally
- Flutter SDK 3.24+ (for mobile app)

#### 1. Database & Backend API
```bash
cd backend
cp .env.example .env
# Configure your DATABASE_URL in .env (e.g., postgresql://postgres:password@localhost:5432/cosmetics_db)

npm install
npm run migrate                  # Runs all 45 database migrations
npm run seed:curated             # Seeds 24 verified Ghana beauty bestsellers with 14 shade variants
npm run dev                      # Starts backend on http://localhost:5000
```

#### 2. Customer Storefront
```bash
cd ../frontend
npm install
npm run dev                      # Starts storefront on http://localhost:5173
```

#### 3. Admin ERP Dashboard
```bash
cd ../admin
npm install
npm run dev                      # Starts admin on http://localhost:5174
```

#### 4. Flutter Mobile App
```bash
cd ../mobile
flutter pub get
flutter run                      # Launches mobile app on connected Android/iOS device or emulator
```

---

## 3. Commercial Credentials & Configuration Guide

All credentials and switches are managed via environment variables and the live Admin Settings page (`http://localhost:3001/settings`).

### 1. Paystack Payment Gateway (Ghana MoMo & Cards)
1. Register for an account on [Paystack](https://paystack.com).
2. Set your keys in `backend/.env`:
   ```env
   PAYSTACK_SECRET_KEY=sk_live_CHANGE_ME
   PAYSTACK_PUBLIC_KEY=pk_live_CHANGE_ME
   ```
3. In your Paystack Dashboard -> Settings -> Webhooks, set the Webhook URL:
   `https://api.yourdomain.com/api/payments/webhook`

### 2. Local Ghana SMS Notifications (Arkesel / Hubtel / mNotify)
The backend includes a native SMS adapter for Ghanaian telecommunications:
```env
# Choose provider: 'arkesel', 'hubtel', or 'mnotify'
SMS_PROVIDER=arkesel
SMS_API_KEY=your_arkesel_api_key_here
SMS_SENDER_ID=BodyCreamGH

# For Hubtel:
SMS_CLIENT_ID=your_hubtel_client_id_here
```
*Note: If unconfigured, the system automatically runs in mock mode and logs SMS messages without failing.*

### 3. Firebase Cloud Messaging (FCM Mobile Push)
To enable real-time order tracking push notifications on mobile lockscreens:
1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com).
2. Add your server key in `backend/.env`:
   ```env
   FCM_SERVER_KEY=your_firebase_server_key_here
   ```
3. Place `google-services.json` in `mobile/android/app/` and `GoogleService-Info.plist` in `mobile/ios/Runner/`.

### 4. Transactional Email (SMTP)
Configure your email service (Gmail, Amazon SES, Brevo, Resend, or SendGrid) in `backend/.env`:
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=orders@yourdomain.com
SMTP_PASS=your_app_specific_password
EMAIL_FROM="BodyCream GH <orders@yourdomain.com>"
```

---

## 4. Operational Playbook for Store Owners

### 1. Managing Cash on Delivery (COD)
- Navigate to **Admin Dashboard -> Settings**.
- Toggle **"Enable Pay on Delivery / Pay on Pickup"** to on/off.
- Toggle **"Restrict Pay on Delivery to Greater Accra & Store Pickup only"** to avoid shipping uncollected parcels nationwide.
- Orders placed via COD display a prominent `[COD - Collect GHS XXX]` alert tag in the order feed.

### 2. Printing Dispatch Waybills & Rider Slips
- Navigate to **Admin Dashboard -> Orders -> Click any Order**.
- Click the **"Print Waybill"** button.
- Toggle between **A4** (standard office printer) and **80mm Thermal** (compact courier label printer).
- Each waybill automatically generates a vector Code128 barcode of the order number, customer phone/address, itemized variant lines, rider/customer signature lines, and high-contrast payment notice (`PAID` vs `COLLECT CASH ON DELIVERY`).

### 3. Recovering Abandoned Carts
- Navigate to **Admin Dashboard -> Orders -> Abandoned Carts tab**.
- View captured shopper checkouts with phone numbers, emails, and dropped cart value.
- Click **"WhatsApp Recovery"** to instantly open a pre-filled WhatsApp message offering the customer the active 5% discount code (`GLOW5`).
- Click **"Send Recovery Email"** to dispatch an automated recovery email with a return-to-cart link.

---

## 5. Mobile App Compilation & Store Release

### Android APK / Google Play Store (AAB)
```bash
cd mobile

# Run full automated test suite (39/39 tests passing)
flutter test

# Build debug APK for testing on physical Android devices:
flutter build apk --debug

# Build signed Android App Bundle (AAB) for Google Play:
flutter build appbundle --release
```
The output file is located at `mobile/build/app/outputs/bundle/release/app-release.aab`.

### iOS App Store (IPA)
```bash
cd mobile
flutter build ios --release
# Open mobile/ios/Runner.xcworkspace in Xcode to configure your Apple Developer Signing Certificate and submit to TestFlight / App Store.
```

---

## 6. Architecture & Directory Overview

```
BodyCreamGH/
├── backend/                   # Node.js Express REST API & Worker
│   ├── migrations/            # 45 Sequential PostgreSQL Migrations
│   ├── src/controllers/       # Order, Product, Review, Admin, Auth Controllers
│   ├── src/models/            # Database Access Objects
│   ├── src/services/          # Paystack, SMS, FCM, Courier, Email Services
│   └── src/routes/            # Express Route Declarations
├── frontend/                  # React 19 Storefront Web Application
│   ├── src/pages/             # Shop, ProductPage, Cart, Checkout, Account
│   ├── src/components/        # ProductCard, StarRating, WhatsAppFloat, Nav
│   └── src/context/           # Cart, Auth, Toast, Wishlist, Settings Contexts
├── admin/                     # Multi-Role React ERP Dashboard
│   ├── src/pages/             # Orders, Products, Inventory, Customers, Settings
│   └── src/utils/             # printWaybill.js, printInvoice.js, formatters
├── mobile/                    # Flutter Cross-Platform Mobile App
│   ├── lib/screens/           # Home, Shop, ProductDetail, Cart, Checkout, Orders
│   ├── lib/providers/         # Cart, Auth, Theme, Wishlist Providers
│   ├── lib/services/          # ApiService, WhatsAppHelper
│   └── test/                  # 39 Automated Unit & Widget Tests
├── docker-compose.yml         # 1-Command Production/Demo Stack
└── BUYER_MANUAL.md            # Commercial Handover & Operations Guide
```

---

## 7. Support & Maintenance

This software package is delivered with complete source code rights. There are no ongoing licensing royalties or per-transaction platform fees. All revenues generated through Paystack or Cash on Delivery settle directly to the merchant's bank account or Mobile Money wallet.

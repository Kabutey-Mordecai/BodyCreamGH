import { Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import AdminLayout from './layout/AdminLayout';
import ErrorBoundary from './components/ErrorBoundary';
import { lazyWithRetry, triggerSingleChunkReload } from './utils/lazyWithRetry';

if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    triggerSingleChunkReload();
  });
}

// Route-level code splitting isolates heavy dependencies (e.g. Tiptap in Compose)
// into on-demand chunks so initial admin boot stays fast.
const Login           = lazyWithRetry(() => import('./pages/Login'));
const Dashboard       = lazyWithRetry(() => import('./pages/Dashboard'));
const Products        = lazyWithRetry(() => import('./pages/Products'));
const ProductEditor   = lazyWithRetry(() => import('./pages/ProductEditor'));
const Orders          = lazyWithRetry(() => import('./pages/Orders'));
const OrderDetail     = lazyWithRetry(() => import('./pages/OrderDetail'));
const Riders          = lazyWithRetry(() => import('./pages/Riders'));
const Customers       = lazyWithRetry(() => import('./pages/Customers'));
const CustomerDetail  = lazyWithRetry(() => import('./pages/CustomerDetail'));
const Inventory       = lazyWithRetry(() => import('./pages/Inventory'));
const Analytics       = lazyWithRetry(() => import('./pages/Analytics'));
const Storefront      = lazyWithRetry(() => import('./pages/Storefront'));
const Theme           = lazyWithRetry(() => import('./pages/Theme'));
const Settings        = lazyWithRetry(() => import('./pages/Settings'));
const Reviews         = lazyWithRetry(() => import('./pages/Reviews'));
const Coupons         = lazyWithRetry(() => import('./pages/Coupons'));
const Requests        = lazyWithRetry(() => import('./pages/Requests'));
const Financials      = lazyWithRetry(() => import('./pages/Financials'));
const AdminAccounts   = lazyWithRetry(() => import('./pages/AdminAccounts'));
const Compose         = lazyWithRetry(() => import('./pages/Compose'));
const Subscribers     = lazyWithRetry(() => import('./pages/Subscribers'));
const CampaignHistory = lazyWithRetry(() => import('./pages/CampaignHistory'));
const Promotions      = lazyWithRetry(() => import('./pages/Promotions'));

function AdminFallback() {
  return (
    <div style={{ padding: '48px 24px', textAlign: 'center', opacity: 0.65 }}>
      Loading…
    </div>
  );
}

export default function App() {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary resetKey={pathname}>
      <Suspense fallback={<AdminFallback />}>
        <Routes>
          {/* Public auth route — no sidebar/topbar chrome */}
          <Route path="/login" element={<Login />} />

          {/* All admin pages live inside AdminLayout (sidebar + topbar). */}
          <Route element={<ProtectedRoute><AdminLayout /></ProtectedRoute>}>
            <Route path="/"                       element={<Dashboard />} />
            <Route path="/products"               element={<Products />} />
            <Route path="/products/new"           element={<ProductEditor />} />
            <Route path="/products/:id"           element={<ProductEditor />} />
            <Route path="/orders"                 element={<Orders />} />
            <Route path="/orders/:id"             element={<OrderDetail />} />
            <Route path="/riders"                 element={<Riders />} />
            <Route path="/customers"              element={<Customers />} />
            <Route path="/customers/:id"          element={<CustomerDetail />} />
            <Route path="/inventory"              element={<Inventory />} />
            <Route path="/analytics"              element={<Analytics />} />
            <Route path="/storefront"             element={<Storefront />} />
            <Route path="/theme"                  element={<Theme />} />
            <Route path="/settings"               element={<Settings />} />
            <Route path="/settings/admins"        element={<AdminAccounts />} />
            <Route path="/reviews"                element={<Reviews />} />
            <Route path="/coupons"                element={<Coupons />} />
            <Route path="/requests"               element={<Requests />} />
            <Route path="/financials"             element={<Financials />} />
            <Route path="/newsletter/compose"     element={<Compose />} />
            <Route path="/newsletter/subscribers" element={<Subscribers />} />
            <Route path="/newsletter/history"     element={<CampaignHistory />} />
            <Route path="/promotions"             element={<Promotions />} />
          </Route>

          {/* Anything else → redirect to the dashboard (ProtectedRoute handles auth check) */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

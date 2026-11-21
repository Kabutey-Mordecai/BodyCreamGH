import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import AdminLayout from './layout/AdminLayout';
import ErrorBoundary from './components/ErrorBoundary';

// Route-level code splitting isolates heavy dependencies (e.g. Tiptap in Compose)
// into on-demand chunks so initial admin boot stays fast.
const Login           = lazy(() => import('./pages/Login'));
const Dashboard       = lazy(() => import('./pages/Dashboard'));
const Products        = lazy(() => import('./pages/Products'));
const ProductEditor   = lazy(() => import('./pages/ProductEditor'));
const Orders          = lazy(() => import('./pages/Orders'));
const OrderDetail     = lazy(() => import('./pages/OrderDetail'));
const Customers       = lazy(() => import('./pages/Customers'));
const CustomerDetail  = lazy(() => import('./pages/CustomerDetail'));
const Inventory       = lazy(() => import('./pages/Inventory'));
const Analytics       = lazy(() => import('./pages/Analytics'));
const Storefront      = lazy(() => import('./pages/Storefront'));
const Theme           = lazy(() => import('./pages/Theme'));
const Settings        = lazy(() => import('./pages/Settings'));
const Reviews         = lazy(() => import('./pages/Reviews'));
const Coupons         = lazy(() => import('./pages/Coupons'));
const Requests        = lazy(() => import('./pages/Requests'));
const Financials      = lazy(() => import('./pages/Financials'));
const AdminAccounts   = lazy(() => import('./pages/AdminAccounts'));
const Compose         = lazy(() => import('./pages/Compose'));
const Subscribers     = lazy(() => import('./pages/Subscribers'));
const CampaignHistory = lazy(() => import('./pages/CampaignHistory'));
const Promotions      = lazy(() => import('./pages/Promotions'));

function AdminFallback() {
  return (
    <div style={{ padding: '48px 24px', textAlign: 'center', opacity: 0.65 }}>
      Loading…
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
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

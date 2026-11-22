import { Routes, Route, useLocation } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import Navigation from './components/Navigation';
import Footer from './components/Footer';
import WhatsAppFloat from './components/WhatsAppFloat';
import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';
import Home from './pages/Home';

function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      const id = hash.slice(1);
      const tryScroll = () => {
        const el = document.getElementById(id);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth' });
          return true;
        }
        return false;
      };
      if (!tryScroll()) {
        const timer = setTimeout(tryScroll, 120);
        return () => clearTimeout(timer);
      }
      return;
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

function PageFallback() {
  return (
    <div className="container" style={{ padding: '64px 24px', textAlign: 'center', color: 'var(--color-muted)' }}>
      Loading…
    </div>
  );
}

// Route-level code splitting keeps the initial storefront JS lean on mobile networks.
const Shop            = lazy(() => import('./pages/Shop'));
const PolicyPage      = lazy(() => import('./pages/PolicyPage'));
const ProductPage     = lazy(() => import('./pages/ProductPage'));
const Cart            = lazy(() => import('./pages/Cart'));
const Checkout        = lazy(() => import('./pages/Checkout'));
const Login           = lazy(() => import('./pages/Login'));
const Register        = lazy(() => import('./pages/Register'));
const ForgotPassword  = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword   = lazy(() => import('./pages/ResetPassword'));
const PaymentCallback = lazy(() => import('./pages/PaymentCallback'));
const Account         = lazy(() => import('./pages/Account'));
const Orders          = lazy(() => import('./pages/Orders'));
const OrderDetail     = lazy(() => import('./pages/OrderDetail'));
const Wishlist        = lazy(() => import('./pages/Wishlist'));
const Unsubscribe     = lazy(() => import('./pages/Unsubscribe'));
const TrackOrder      = lazy(() => import('./pages/TrackOrder'));
const PrivacyNotice   = lazy(() =>
  import('./components/PrivacyNotice').catch((err) => {
    console.warn('[PrivacyNotice] Notice blocked by client adblocker or unavailable:', err?.message);
    return { default: () => null };
  })
);

function RouteFade({ children }) {
  const { pathname } = useLocation();
  return <div key={pathname} className="page-transition">{children}</div>;
}

function AdminRedirect() {
  useEffect(() => {
    window.location.href = 'http://localhost:5174';
  }, []);
  return (
    <div style={{ textAlign: 'center', padding: '80px 20px' }}>
      <h2>Opening Admin Console…</h2>
      <p style={{ marginTop: 12, color: 'var(--color-muted)' }}>
        Redirecting to port 5174. If not redirected automatically,{' '}
        <a href="http://localhost:5174" style={{ color: 'var(--color-accent-dark)', fontWeight: 600 }}>click here to enter Admin</a>.
      </p>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <div className="app">
        <ScrollToTop />
        <Navigation />

        <main className="main-content">
          <Suspense fallback={<PageFallback />}>
            <RouteFade>
            <Routes>
              {/* Public routes — anyone can visit these */}
              <Route path="/"                    element={<Home />} />
              <Route path="/shop"                element={<Shop />} />
              <Route path="/products/:id"        element={<ProductPage />} />
              <Route path="/login"               element={<Login />} />
              <Route path="/register"            element={<Register />} />
              <Route path="/forgot-password"     element={<ForgotPassword />} />
              <Route path="/reset-password"      element={<ResetPassword />} />
              <Route path="/unsubscribe"         element={<Unsubscribe />} />
              <Route path="/track"               element={<TrackOrder />} />
              <Route path="/track-order"         element={<TrackOrder />} />
              <Route path="/privacy-policy"      element={<PolicyPage type="privacy" />} />
              <Route path="/terms"               element={<PolicyPage type="terms" />} />
              <Route path="/refund-policy"       element={<PolicyPage type="refund" />} />
              <Route path="/shipping-policy"     element={<PolicyPage type="shipping" />} />
              <Route path="/contact"             element={<PolicyPage type="contact" />} />

              {/* Payment callback — visited after Paystack redirects back */}
              <Route path="/payment/callback"    element={<ErrorBoundary><PaymentCallback /></ErrorBoundary>} />

              {/* Cart & checkout (guest + authenticated) */}
              <Route path="/cart"       element={<Cart />} />
              <Route path="/checkout"   element={<ErrorBoundary><Checkout /></ErrorBoundary>} />

              {/* Admin Portal Redirect (port 5174 in dev) */}
              <Route path="/admin"      element={<AdminRedirect />} />
              <Route path="/admin/*"    element={<AdminRedirect />} />

              {/* Protected routes — redirect to /login if not authenticated */}
              <Route path="/account"    element={<ProtectedRoute><Account /></ProtectedRoute>} />
              <Route path="/orders"     element={<ProtectedRoute><Orders /></ProtectedRoute>} />
              <Route path="/orders/:id" element={<ProtectedRoute><OrderDetail /></ProtectedRoute>} />
              <Route path="/wishlist"   element={<ProtectedRoute><Wishlist /></ProtectedRoute>} />
            </Routes>
            </RouteFade>
          </Suspense>
        </main>

        <Footer />
        <WhatsAppFloat />
        <Suspense fallback={null}>
          <PrivacyNotice />
        </Suspense>
      </div>
    </ErrorBoundary>
  );
}

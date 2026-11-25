import { Routes, Route, useLocation, Link } from 'react-router-dom';
import { Suspense, useEffect } from 'react';
import { useSettings } from './context/SettingsContext';
import Navigation from './components/Navigation';
import Footer from './components/Footer';
import WhatsAppFloat from './components/WhatsAppFloat';
import StickyCartBar from './components/StickyCartBar';
import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';
import { lazyWithRetry } from './utils/lazyWithRetry';
import Home from './pages/Home';
import Shop from './pages/Shop';

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
// Shop & Home are eagerly loaded so switching between primary tabs is instant with zero chunk risk.
const PolicyPage      = lazyWithRetry(() => import('./pages/PolicyPage'));
const ProductPage     = lazyWithRetry(() => import('./pages/ProductPage'));
const Cart            = lazyWithRetry(() => import('./pages/Cart'));
const Checkout        = lazyWithRetry(() => import('./pages/Checkout'));
const Login           = lazyWithRetry(() => import('./pages/Login'));
const Register        = lazyWithRetry(() => import('./pages/Register'));
const ForgotPassword  = lazyWithRetry(() => import('./pages/ForgotPassword'));
const ResetPassword   = lazyWithRetry(() => import('./pages/ResetPassword'));
const PaymentCallback = lazyWithRetry(() => import('./pages/PaymentCallback'));
const Account         = lazyWithRetry(() => import('./pages/Account'));
const Orders          = lazyWithRetry(() => import('./pages/Orders'));
const OrderDetail     = lazyWithRetry(() => import('./pages/OrderDetail'));
const Wishlist        = lazyWithRetry(() => import('./pages/Wishlist'));
const Unsubscribe     = lazyWithRetry(() => import('./pages/Unsubscribe'));
const TrackOrder      = lazyWithRetry(() => import('./pages/TrackOrder'));
const RiderHandoff    = lazyWithRetry(() => import('./pages/RiderHandoff'));
const RiderManifest   = lazyWithRetry(() => import('./pages/RiderManifest'));
const PrivacyNotice   = lazyWithRetry(() =>
  import('./components/PrivacyNotice').catch((err) => {
    console.warn('[PrivacyNotice] Notice blocked by client adblocker or unavailable:', err?.message);
    return { default: () => null };
  })
);

const ROUTE_TITLE_PREFIXES = {
  '/cart': 'Shopping Cart',
  '/checkout': 'Checkout',
  '/login': 'Sign In',
  '/register': 'Create Account',
  '/orders': 'My Orders',
  '/track': 'Track Order',
  '/track-order': 'Track Order',
  '/account': 'My Account',
  '/wishlist': 'Wishlist',
};

function getVisitorId() {
  try {
    let vid = localStorage.getItem('bc_vid');
    if (!vid) {
      vid = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem('bc_vid', vid);
    }
    return vid;
  } catch {
    return '';
  }
}

function RouteFade({ children }) {
  const { pathname } = useLocation();
  const settings = useSettings();
  const storeName = settings?.store_name || 'BodyCream GH';
  useEffect(() => {
    if (ROUTE_TITLE_PREFIXES[pathname]) {
      document.title = `${ROUTE_TITLE_PREFIXES[pathname]} — ${storeName}`;
      let robotsEl = document.head.querySelector('meta[name="robots"]');
      if (!robotsEl) {
        robotsEl = document.createElement('meta');
        robotsEl.setAttribute('name', 'robots');
        document.head.appendChild(robotsEl);
      }
      robotsEl.setAttribute('content', 'noindex, nofollow');
    }
  }, [pathname, storeName]);
  useEffect(() => {
    const apiBase = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
    fetch(`${apiBase}/traffic/visit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: pathname,
        visitor_id: getVisitorId(),
        referrer: typeof document !== 'undefined' ? document.referrer || '' : '',
      }),
    }).catch(() => {});
  }, [pathname]);
  return (
    <ErrorBoundary resetKey={pathname}>
      <div key={pathname} className="page-transition">{children}</div>
    </ErrorBoundary>
  );
}

function AdminRedirect() {
  const adminUrl = import.meta.env.VITE_ADMIN_URL || (import.meta.env.DEV ? 'http://localhost:5174' : '');

  useEffect(() => {
    if (adminUrl) {
      window.location.href = adminUrl;
    }
  }, [adminUrl]);

  if (!adminUrl) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 20px' }}>
        <h2>Admin Console Unavailable</h2>
        <p style={{ marginTop: 12, color: 'var(--color-muted)' }}>
          The admin console URL is not configured for this environment. Please contact your site administrator.
        </p>
        <Link to="/" className="btn btn-outline" style={{ marginTop: 20, display: 'inline-block' }}>
          Return to Storefront
        </Link>
      </div>
    );
  }

  return (
    <div style={{ textAlign: 'center', padding: '80px 20px' }}>
      <h2>Opening Admin Console…</h2>
      <p style={{ marginTop: 12, color: 'var(--color-muted)' }}>
        Redirecting to the admin console. If not redirected automatically,{' '}
        <a href={adminUrl} style={{ color: 'var(--color-accent-dark)', fontWeight: 600 }}>click here to enter Admin</a>.
      </p>
    </div>
  );
}

export default function App() {
  const { pathname } = useLocation();
  const isRiderRoute = pathname.startsWith('/rider-manifest') || pathname.startsWith('/rider-handoff');
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
              <Route path="/rider-handoff"       element={<RiderHandoff />} />
              <Route path="/rider-manifest"      element={<RiderManifest />} />
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
        <StickyCartBar />
        {!isRiderRoute && <WhatsAppFloat />}
        {!isRiderRoute && (
          <Suspense fallback={null}>
            <PrivacyNotice />
          </Suspense>
        )}
      </div>
    </ErrorBoundary>
  );
}

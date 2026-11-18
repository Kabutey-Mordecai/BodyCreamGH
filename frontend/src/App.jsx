import { Routes, Route, useLocation } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import Navigation from './components/Navigation';
import CategoryBar from './components/CategoryBar';
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
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
        return;
      }
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

function RouteFade({ children }) {
  const { pathname } = useLocation();
  return <div key={pathname} className="page-transition">{children}</div>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <div className="app">
        <ScrollToTop />
        <Navigation />

        <main className="main-content">
          <CategoryBar />
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

              {/* Payment callback — visited after Paystack redirects back */}
              <Route path="/payment/callback"    element={<ErrorBoundary><PaymentCallback /></ErrorBoundary>} />

              {/* Cart & checkout (guest + authenticated) */}
              <Route path="/cart"       element={<Cart />} />
              <Route path="/checkout"   element={<ErrorBoundary><Checkout /></ErrorBoundary>} />

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
      </div>
    </ErrorBoundary>
  );
}

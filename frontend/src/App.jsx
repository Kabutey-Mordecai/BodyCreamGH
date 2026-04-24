import { Routes, Route } from 'react-router-dom';
import Navigation from './components/Navigation';
import Footer from './components/Footer';
import ProtectedRoute from './components/ProtectedRoute';

import Home            from './pages/Home';
import Shop            from './pages/Shop';
import ProductPage     from './pages/ProductPage';
import Cart            from './pages/Cart';
import Checkout        from './pages/Checkout';
import Login           from './pages/Login';
import Register        from './pages/Register';
import ForgotPassword  from './pages/ForgotPassword';
import ResetPassword   from './pages/ResetPassword';
import PaymentCallback from './pages/PaymentCallback';
import Account         from './pages/Account';
import Orders          from './pages/Orders';
import OrderDetail     from './pages/OrderDetail';
import Wishlist        from './pages/Wishlist';

export default function App() {
  return (
    <div className="app">
      <Navigation />

      <main className="main-content">
        <Routes>
          {/* Public routes — anyone can visit these */}
          <Route path="/"                    element={<Home />} />
          <Route path="/shop"                element={<Shop />} />
          <Route path="/products/:id"        element={<ProductPage />} />
          <Route path="/login"               element={<Login />} />
          <Route path="/register"            element={<Register />} />
          <Route path="/forgot-password"     element={<ForgotPassword />} />
          <Route path="/reset-password"      element={<ResetPassword />} />

          {/* Payment callback — visited after Paystack redirects back */}
          <Route path="/payment/callback"    element={<PaymentCallback />} />

          {/* Protected routes — redirect to /login if not authenticated */}
          <Route path="/cart"       element={<Cart />} />
          <Route path="/checkout"   element={<Checkout />} />
          <Route path="/account"    element={<ProtectedRoute><Account /></ProtectedRoute>} />
          <Route path="/orders"     element={<ProtectedRoute><Orders /></ProtectedRoute>} />
          <Route path="/orders/:id" element={<ProtectedRoute><OrderDetail /></ProtectedRoute>} />
          <Route path="/wishlist"   element={<ProtectedRoute><Wishlist /></ProtectedRoute>} />
        </Routes>
      </main>

      <Footer />
    </div>
  );
}

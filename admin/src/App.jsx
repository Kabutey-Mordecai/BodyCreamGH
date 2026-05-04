import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import AdminLayout from './layout/AdminLayout';

import Login         from './pages/Login';
import Dashboard     from './pages/Dashboard';
import Products      from './pages/Products';
import ProductEditor from './pages/ProductEditor';
import Orders        from './pages/Orders';
import OrderDetail   from './pages/OrderDetail';
import Customers       from './pages/Customers';
import CustomerDetail  from './pages/CustomerDetail';
import Inventory     from './pages/Inventory';
import Analytics     from './pages/Analytics';
import Storefront    from './pages/Storefront';
import Theme         from './pages/Theme';
import Settings      from './pages/Settings';
import Reviews        from './pages/Reviews';
import Coupons        from './pages/Coupons';
import Requests         from './pages/Requests';
import Financials       from './pages/Financials';
import AdminAccounts    from './pages/AdminAccounts';
import Compose          from './pages/Compose';
import Subscribers      from './pages/Subscribers';
import CampaignHistory  from './pages/CampaignHistory';
import Promotions       from './pages/Promotions';

export default function App() {
  return (
    <Routes>
      {/* Public auth route — no sidebar/topbar chrome */}
      <Route path="/login" element={<Login />} />

      {/* All admin pages live inside AdminLayout (sidebar + topbar). */}
      <Route element={<ProtectedRoute><AdminLayout /></ProtectedRoute>}>
        <Route path="/"                element={<Dashboard />} />
        <Route path="/products"        element={<Products />} />
        <Route path="/products/new"    element={<ProductEditor />} />
        <Route path="/products/:id"    element={<ProductEditor />} />
        <Route path="/orders"          element={<Orders />} />
        <Route path="/orders/:id"      element={<OrderDetail />} />
        <Route path="/customers"        element={<Customers />} />
        <Route path="/customers/:id"    element={<CustomerDetail />} />
        <Route path="/inventory"       element={<Inventory />} />
        <Route path="/analytics"       element={<Analytics />} />
        <Route path="/storefront"      element={<Storefront />} />
        <Route path="/theme"           element={<Theme />} />
        <Route path="/settings"              element={<Settings />} />
        <Route path="/settings/admins"       element={<AdminAccounts />} />
        <Route path="/reviews"               element={<Reviews />} />
        <Route path="/coupons"               element={<Coupons />} />
        <Route path="/requests"              element={<Requests />} />
        <Route path="/financials"            element={<Financials />} />
        <Route path="/newsletter/compose"    element={<Compose />} />
        <Route path="/newsletter/subscribers" element={<Subscribers />} />
        <Route path="/newsletter/history"    element={<CampaignHistory />} />
        <Route path="/promotions"            element={<Promotions />} />
      </Route>

      {/* Anything else → redirect to the dashboard (ProtectedRoute handles auth check) */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

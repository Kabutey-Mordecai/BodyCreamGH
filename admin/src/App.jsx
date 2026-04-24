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
import Reviews       from './pages/Reviews';

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
        <Route path="/settings"        element={<Settings />} />
        <Route path="/reviews"         element={<Reviews />} />
      </Route>

      {/* Anything else → redirect to the dashboard (ProtectedRoute handles auth check) */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

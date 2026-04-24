import axios from 'axios';

// In dev, Vite proxies /api to localhost:3000. In production set VITE_API_URL.
const API_BASE = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({ baseURL: API_BASE });

// Attach the admin's JWT to every request.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('admin_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auto-logout on 401 to keep the admin from looping on a dead session.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && !window.location.pathname.startsWith('/login')) {
      localStorage.removeItem('admin_token');
      localStorage.removeItem('admin_user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

// ── Auth ──────────────────────────────────────────────────────────────
export const authAPI = {
  login:  (data) => api.post('/auth/login', data),
  logout: ()     => api.post('/auth/logout'),
  getMe:  ()     => api.get('/auth/me'),
};

// ── Admin overview / analytics ────────────────────────────────────────
export const adminAPI = {
  getDashboard:          ()     => api.get('/admin/dashboard'),
  getAnalytics:          ()     => api.get('/admin/analytics'),
  getTopProducts:        ()     => api.get('/admin/top-products'),
  getInventoryOverview:  ()     => api.get('/admin/inventory'),
  getAllCustomers:        ()     => api.get('/admin/customers'),
  getAllReviews:          ()     => api.get('/admin/reviews'),
  deleteReview:          (id)   => api.delete(`/admin/reviews/${id}`),
};

// ── Products ──────────────────────────────────────────────────────────
export const productsAPI = {
  getAll:  (params) => api.get('/products', { params }),
  getById: (id)     => api.get(`/products/${id}`),
  create:  (data)   => api.post('/products', data),
  update:  (id, d)  => api.put(`/products/${id}`, d),
  remove:  (id)     => api.delete(`/products/${id}`),
};

// ── Orders (admin sees all) ───────────────────────────────────────────
export const ordersAPI = {
  getAll:       ()           => api.get('/orders/admin/all'),
  getById:      (id)         => api.get(`/orders/${id}`),
  updateStatus: (id, status) => api.patch(`/orders/${id}/status`, { status }),
};

// ── Inventory ─────────────────────────────────────────────────────────
export const inventoryAPI = {
  getHistory: (productId)  => api.get(`/inventory/${productId}/history`),
  adjust:     (productId, { quantity_change, reason, notes }) =>
    api.post(`/inventory/${productId}/adjust`, { quantity_change, reason, notes }),
};

// ── Site settings — powers the Storefront Editor + Theme Customizer ─
// These call endpoints that need to exist on the backend (see backend/src/routes/settings.js).
// In the meantime the admin falls back to localStorage so the editors still work.
export const settingsAPI = {
  getAll: ()     => api.get('/settings'),
  update: (key, value) => api.put('/settings', { key, value }),
  updateMany: (entries) => api.put('/settings/bulk', { entries }),
};

// ── Customers ─────────────────────────────────────────────────────────
export const customersAPI = {
  getById:   (id) => api.get(`/customers/${id}`),
  getOrders: (id) => api.get(`/customers/${id}/orders`),
};

// ── Deliveries ────────────────────────────────────────────────────────
export const deliveriesAPI = {
  getByOrder: (orderId)              => api.get(`/deliveries/order/${orderId}`),
  create:     (data)                 => api.post('/deliveries', data),
  update:     (deliveryId, data)     => api.patch(`/deliveries/${deliveryId}`, data),
};

export default api;

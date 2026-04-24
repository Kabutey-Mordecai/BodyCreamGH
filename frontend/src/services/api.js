import axios from 'axios';

// VITE_ prefix is required by Vite to expose env variables to the browser bundle.
// In development the Vite proxy in vite.config.js forwards /api to localhost:3000,
// so VITE_API_URL is only needed when deploying to production (e.g. Netlify).
const API_BASE = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({ baseURL: API_BASE });

// ── Request interceptor ───────────────────────────────────────────────────────
// Automatically attach the JWT to every request so individual calls don't
// have to manually set the Authorization header each time.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Response interceptor ──────────────────────────────────────────────────────
// A 401 means the token is expired or blacklisted (user logged out elsewhere).
// Clear local storage and redirect to login rather than showing confusing errors.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Only wipe session and redirect if we're not already on an auth page.
      // Without this guard we'd get an infinite redirect loop on /login.
      const publicPaths = ['/login', '/register', '/forgot-password', '/reset-password'];
      const isOnPublicPage = publicPaths.some(p => window.location.pathname.startsWith(p));

      if (!isOnPublicPage) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authAPI = {
  register:         (data)    => api.post('/auth/register', data),
  login:            (data)    => api.post('/auth/login', data),
  logout:           ()        => api.post('/auth/logout'),
  getMe:            ()        => api.get('/auth/me'),
  forgotPassword:   (email)   => api.post('/auth/forgot-password', { email }),
  verifyResetToken: (token)   => api.get(`/auth/verify-reset-token/${token}`),
  resetPassword:    (data)    => api.post('/auth/reset-password', data),
};

// ── Products ──────────────────────────────────────────────────────────────────
export const productsAPI = {
  getAll:  (params) => api.get('/products', { params }),
  getById: (id)     => api.get(`/products/${id}`),
};

// ── Cart ──────────────────────────────────────────────────────────────────────
export const cartAPI = {
  getCart:    ()                      => api.get('/cart'),
  addItem:    (productId, quantity=1) => api.post('/cart/add', { product_id: productId, quantity }),
  updateItem: (cartItemId, quantity)  => api.patch(`/cart/${cartItemId}`, { quantity }),
  removeItem: (cartItemId)            => api.delete(`/cart/${cartItemId}`),
  clear:      ()                      => api.delete('/cart'),
};

// ── Orders ────────────────────────────────────────────────────────────────────
export const ordersAPI = {
  create:  (data) => api.post('/orders', data),
  getAll:  ()     => api.get('/orders'),
  getById: (id)   => api.get(`/orders/${id}`),
};

// ── Payments ──────────────────────────────────────────────────────────────────
export const paymentsAPI = {
  // initialize returns { authorization_url, reference } — we redirect the user there
  initialize: (orderId) => api.post('/payments/initialize', { orderId }),
  // verify is called after Paystack redirects back with ?reference=...
  verify:     (reference) => api.post('/payments/verify', { reference }),
};

// ── Customer profile ──────────────────────────────────────────────────────────
export const customerAPI = {
  getProfile:     ()     => api.get('/customers/profile'),
  updateProfile:  (data) => api.put('/customers/profile', data),
  changePassword: (data) => api.put('/customers/password', data),
};

// ── Deliveries ────────────────────────────────────────────────────────────────
export const deliveriesAPI = {
  getByOrder: (orderId) => api.get(`/deliveries/order/${orderId}`),
};

export default api;

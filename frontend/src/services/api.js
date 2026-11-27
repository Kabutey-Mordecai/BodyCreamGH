import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
  baseURL: API_BASE,
  headers: {
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
  },
});

// ── Request interceptor ───────────────────────────────────────────────────────
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ── Response interceptor with automatic token refresh ────────────────────────
// On 401: try to exchange the stored refresh_token for a new access token,
// then transparently retry the original request. If the refresh itself fails,
// clear the session and redirect to /login.
// A pending-queue prevents concurrent 401s from each firing a separate refresh.

const AUTH_PATHS = ['/auth/refresh', '/auth/login', '/auth/register'];
const PUBLIC_ROUTES = [
  '/',
  '/shop',
  '/products',
  '/cart',
  '/track',
  '/privacy-policy',
  '/terms',
  '/refund-policy',
  '/shipping-policy',
  '/contact',
  '/unsubscribe',
  '/rider-handoff',
  '/rider-manifest',
  '/payment/callback',
  '/payment-callback',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
];

let isRefreshing = false;
let pendingQueue = []; // [{ resolve, reject }]

function drainQueue(err, token) {
  pendingQueue.forEach(cb => err ? cb.reject(err) : cb.resolve(token));
  pendingQueue = [];
}

function clearSession() {
  localStorage.removeItem('token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('user');
  window.dispatchEvent(new CustomEvent('auth:session_expired'));
  const { pathname } = window.location;
  const isPublic = PUBLIC_ROUTES.some(p =>
    p === '/' ? pathname === '/' : pathname.startsWith(p)
  );
  if (!isPublic) window.location.href = '/login';
}

api.interceptors.response.use(
  res => res,
  async (error) => {
    const orig = error.config;

    // Only act on 401s we haven't already retried
    if (error.response?.status !== 401 || orig._retry) {
      return Promise.reject(error);
    }

    // Don't attempt refresh when the failing request IS an auth endpoint
    if (AUTH_PATHS.some(p => orig.url?.includes(p))) {
      clearSession();
      return Promise.reject(error);
    }

    // While a refresh is in-flight, queue this request instead of firing another refresh
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        pendingQueue.push({ resolve, reject });
      }).then(token => {
        orig.headers.Authorization = `Bearer ${token}`;
        return api(orig);
      });
    }

    orig._retry = true;
    isRefreshing = true;

    const refreshToken = localStorage.getItem('refresh_token');
    if (!refreshToken) {
      isRefreshing = false;
      clearSession();
      return Promise.reject(error);
    }

    try {
      // Use raw axios (not `api`) to avoid triggering this interceptor again
      const { data } = await axios.post(`${API_BASE}/auth/refresh`, { refresh_token: refreshToken });

      localStorage.setItem('token', data.token);
      if (data.refresh_token) localStorage.setItem('refresh_token', data.refresh_token);

      api.defaults.headers.common.Authorization = `Bearer ${data.token}`;
      orig.headers.Authorization = `Bearer ${data.token}`;

      drainQueue(null, data.token);
      isRefreshing = false;

      return api(orig); // retry the original request with the new token
    } catch (refreshErr) {
      drainQueue(refreshErr, null);
      isRefreshing = false;
      clearSession();
      return Promise.reject(refreshErr);
    }
  }
);

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authAPI = {
  register:         (data)    => api.post('/auth/register', data),
  login:            (data)    => api.post('/auth/login', data),
  logout:           (data={}) => api.post('/auth/logout', data),
  getMe:            ()        => api.get('/auth/me'),
  forgotPassword:   (email)        => api.post('/auth/forgot-password', { email }),
  verifyResetToken: (token, email) =>
    api.get(`/auth/verify-reset-token/${encodeURIComponent(token)}`, email ? { params: { email } } : undefined),
  resetPassword:    (data)         => api.post('/auth/reset-password', data),
};

// ── Products ──────────────────────────────────────────────────────────────────
export const productsAPI = {
  getAll:        (params) => api.get('/products', { params }),
  suggest:       (q)      => api.get('/products/suggest', { params: { q } }),
  getCategories: ()       => api.get('/products/categories'),
  getBrands:     ()       => api.get('/products/brands'),
  getFacets:     (params) => api.get('/products/facets', { params }),
  getById:       (id)     => api.get(`/products/${id}`),
  getRelated:  (id)     => api.get(`/products/${id}/related`),
  getVariants: (id)     => api.get(`/products/${id}/variants`),
};

// ── Cart ──────────────────────────────────────────────────────────────────────
export const cartAPI = {
  getCart:       ()                                                    => api.get('/cart'),
  addItem:       (productId, quantity=1, variantId=null)              => api.post('/cart/add', { product_id: productId, quantity, variant_id: variantId || undefined }),
  updateItem:    (cartItemId, quantity)                               => api.patch(`/cart/${cartItemId}`, { quantity }),
  removeItem:    (cartItemId)                                         => api.delete(`/cart/${cartItemId}`),
  clear:         ()                                                    => api.delete('/cart'),
  validateGuest: (items)                                              => api.post('/cart/validate-guest', { items }),
};

// ── Orders ────────────────────────────────────────────────────────────────────
export const ordersAPI = {
  create:          (data)   => api.post('/orders', data),
  createGuest:     (data)   => api.post('/orders/guest', data),
  saveCheckoutSession: (data) => api.post('/orders/checkout-session', data),
  getAll:          (params) => api.get('/orders', { params }),
  getById:         (id)     => api.get(`/orders/${id}`),
  getStatusLog:    (id)     => api.get(`/orders/${id}/log`),
  getReviewStatus: (id)     => api.get(`/orders/${id}/review-status`),
  requestCancel:   (id, reason) => api.post(`/orders/${id}/request-cancel`, { reason }),
  requestReturn:   (id, reason) => api.post(`/orders/${id}/request-return`, { reason }),
  getReturns:      (id)         => api.get(`/orders/${id}/returns`),
  createReturn:    (id, data)   => api.post(`/orders/${id}/returns`, data),
  cancelReturn:    (id, retId)  => api.post(`/orders/${id}/returns/${retId}/cancel`),
};

// ── Payments ──────────────────────────────────────────────────────────────────
export const paymentsAPI = {
  initialize:      (orderId)           => api.post('/payments/initialize', { orderId }),
  initializeGuest: (orderId, email)    => api.post('/payments/guest/initialize', { orderId, email }),
  chargeMomo:      (data)              => api.post('/payments/charge-momo', data),
  submitOtp:       (data)              => api.post('/payments/submit-otp', data),
  verify:          (reference, config) => api.post('/payments/verify', { reference }, config),
};

// ── Customer profile ──────────────────────────────────────────────────────────
export const customerAPI = {
  getProfile:     ()     => api.get('/customers/profile'),
  updateProfile:  (data) => api.put('/customers/profile', data),
  changePassword: (data) => api.put('/customers/password', data),
};

// ── Deliveries ────────────────────────────────────────────────────────────────
export const deliveriesAPI = {
  getByOrder:           (orderId)          => api.get(`/deliveries/order/${orderId}`),
  track:                (trackingNumber)   => api.get(`/deliveries/track/${encodeURIComponent(trackingNumber)}`),
  confirmReceipt:       (orderId)          => api.post(`/deliveries/order/${orderId}/confirm-receipt`),
  getRiderManifest:     (token)            => api.get('/deliveries/rider/manifest', { headers: { 'x-rider-manifest': token } }),
  riderResendOtp:       ({ token, ...body }) => api.post('/deliveries/rider/resend-otp', body, {
    headers: body?.delivery_id ? { 'x-rider-manifest': token } : { 'x-rider-token': token },
  }),
  getRiderHandoff:      (token)            => api.get('/deliveries/rider/handoff', { headers: { 'x-rider-token': token } }),
  uploadRiderPhoto:     (token, formData)  => api.post('/deliveries/rider/photo', formData, {
    headers: { 'Content-Type': 'multipart/form-data', 'x-rider-token': token },
  }),
  confirmRiderDelivery: ({ token, ...body }) => api.post('/deliveries/rider/confirm', body, {
    headers: { 'x-rider-token': token },
  }),
};

// ── Site settings — storefront reads these on load ────────────────────────────
export const settingsAPI = {
  getAll: () => api.get('/settings'),
};

// ── Coupons ───────────────────────────────────────────────────────────────────
export const couponsAPI = {
  validate: (code, orderTotal, email) =>
    api.post('/coupons/validate', { code, orderTotal, ...(email ? { email } : {}) }),
};

// ── Reviews ───────────────────────────────────────────────────────────────────
export const reviewsAPI = {
  getByProduct:      (productId, params)   => api.get(`/products/${productId}/reviews`, { params }),
  canReview:         (productId)           => api.get(`/products/${productId}/reviews/can-review`),
  create:            (productId, data)     => api.post(`/products/${productId}/reviews`, data),
  uploadPhoto:       (formData)            => api.post('/reviews/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  markHelpful:       (productId, reviewId) => api.post(`/products/${productId}/reviews/${reviewId}/helpful`),
  getFeatured:       (params)              => api.get('/reviews/featured', { params }),
  getPendingPrompts: ()                    => api.get('/reviews/pending-prompts'),
};

// ── Order tracking (public) ───────────────────────────────────────────────────
export const trackingAPI = {
  track: (order_number, email) => api.post('/orders/track', { order_number, email }),
};

// ── Wishlist ──────────────────────────────────────────────────────────────────
export const wishlistAPI = {
  getAll:  ()          => api.get('/wishlist'),
  getIds:  ()          => api.get('/wishlist/ids'),
  add:     (productId) => api.post(`/wishlist/${productId}`),
  remove:  (productId) => api.delete(`/wishlist/${productId}`),
};

// ── Newsletter (public) ───────────────────────────────────────────────────────
export const newsletterAPI = {
  subscribe:   (email, name) => api.post('/newsletter/subscribe', { email, name }),
  status:      (email)       => api.get('/newsletter/status', { params: email ? { email } : undefined }),
  unsubscribe: (token)       => api.get('/newsletter/unsubscribe', { params: { token } }),
};

export default api;

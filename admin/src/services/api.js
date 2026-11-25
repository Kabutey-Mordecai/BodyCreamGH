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

// Refresh-and-retry interceptor — tries to use the refresh token before logging out.
let isRefreshing = false;
let pendingQueue = [];

function drainQueue(err, token) {
  pendingQueue.forEach(cb => err ? cb.reject(err) : cb.resolve(token));
  pendingQueue = [];
}

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    if (
      err.response?.status !== 401 ||
      original._retry ||
      window.location.pathname.startsWith('/login')
    ) {
      return Promise.reject(err);
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        pendingQueue.push({ resolve, reject });
      }).then(token => {
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      });
    }

    original._retry = true;
    isRefreshing = true;

    try {
      const refresh_token = localStorage.getItem('admin_refresh_token');
      if (!refresh_token) throw new Error('no refresh token');
      const { data } = await axios.post(`${API_BASE}/auth/refresh`, { refresh_token });
      const newToken = data.token;
      localStorage.setItem('admin_token', newToken);
      if (data.refresh_token) localStorage.setItem('admin_refresh_token', data.refresh_token);
      api.defaults.headers.common.Authorization = `Bearer ${newToken}`;
      drainQueue(null, newToken);
      original.headers.Authorization = `Bearer ${newToken}`;
      return api(original);
    } catch (refreshErr) {
      drainQueue(refreshErr, null);
      localStorage.removeItem('admin_token');
      localStorage.removeItem('admin_refresh_token');
      localStorage.removeItem('admin_user');
      window.location.href = '/login';
      return Promise.reject(refreshErr);
    } finally {
      isRefreshing = false;
    }
  }
);

// ── Auth ──────────────────────────────────────────────────────────────
export const authAPI = {
  login:     (data)    => api.post('/auth/login', data),
  verifyOtp: (data)    => api.post('/auth/verify-otp', data),
  logout:    (data={}) => api.post('/auth/logout', data),
  getMe:     ()        => api.get('/auth/me'),
};

// ── Admin overview / analytics ────────────────────────────────────────
export const adminAPI = {
  omnisearch:             (q)      => api.get('/admin/omnisearch', { params: { q } }),
  getDashboard:           ()       => api.get('/admin/dashboard'),
  getAnalytics:           (params) => api.get('/admin/analytics', { params }),
  getTraffic:             (params) => api.get('/admin/traffic', { params }),
  getFinancials:          (params) => api.get('/admin/financials', { params }),
  getTopProducts:         ()       => api.get('/admin/top-products'),
  getInventoryOverview:   ()       => api.get('/admin/inventory'),
  getAllCustomers:         (params) => api.get('/admin/customers', { params }),
  getReviews:              (params) => api.get('/admin/reviews', { params }),
  getReviewCounts:         ()       => api.get('/admin/reviews/counts'),
  replyToReview:           (id, reply) => api.patch(`/admin/reviews/${id}/reply`, { reply }),
  deleteReview:            (id, reason) => api.delete(`/admin/reviews/${id}`, { data: { reason } }),
  getAdminAccounts:       ()       => api.get('/admin/accounts'),
  createAdminAccount:     (data)   => api.post('/admin/accounts', data),
  deactivateAdminAccount: (id)     => api.patch(`/admin/accounts/${id}/deactivate`),
  activateAdminAccount:   (id)     => api.patch(`/admin/accounts/${id}/activate`),
  uploadMedia: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/admin/media/upload', formData);
  },
};

// ── Products ──────────────────────────────────────────────────────────
export const productsAPI = {
  getAll:          (params) => api.get('/products', { params }),
  getCategories:   ()       => api.get('/products/categories'),
  getBrands:       ()       => api.get('/products/brands'),
  bulkImport:      (items)  => api.post('/products/bulk-import', { items }),
  getAdminAll:     (params) => api.get('/products/admin', { params }),
  getById:         (id)     => api.get(`/products/${id}`),
  create:          (data)   => api.post('/products', data),
  update:          (id, d)  => api.put(`/products/${id}`, d),
  remove:          (id)     => api.delete(`/products/${id}`),
  toggleVisibility:(id)     => api.patch(`/products/${id}/toggle-visibility`),

  // Image gallery — admin-only endpoints under /admin/products/:id/images
  // Axios sets Content-Type: multipart/form-data automatically for FormData.
  uploadProductImages: (productId, files) => {
    const formData = new FormData();
    files.forEach(file => formData.append('images', file));
    return api.post(`/admin/products/${productId}/images`, formData);
  },
  deleteProductImage:    (productId, imageId) => api.delete(`/admin/products/${productId}/images/${imageId}`),
  reorderProductImages:  (productId, order)   => api.put(`/admin/products/${productId}/images/reorder`, { order }),
  setPrimaryProductImage:(productId, imageId) => api.patch(`/admin/products/${productId}/images/${imageId}/primary`),
};

// ── Orders (admin sees all) ───────────────────────────────────────────
export const ordersAPI = {
  getAll:              (params)            => api.get('/orders/admin/all', { params }),
  getAbandoned:        (params)            => api.get('/orders/admin/abandoned', { params }),
  sendAbandonedReminder: (sessionId)       => api.post(`/orders/admin/abandoned/${sessionId}/remind`),
  getRequestCounts:    ()                  => api.get('/orders/admin/requests/counts'),
  getRequests:         (type)              => api.get('/orders/admin/requests', { params: { type } }),
  exportOrders:        (params)            => api.get('/orders/admin/export', { params, responseType: 'blob' }),
  getById:             (id)                => api.get(`/orders/${id}`),
  updateStatus:        (id, status, note)  => api.patch(`/orders/${id}/status`, { status, note }),
  cancelOrder:         (id, reason)        => api.post(`/orders/${id}/cancel`, { reason }),
  refundOrder:         (id, data)          => api.post(`/orders/${id}/refund`, data),
  refundDuplicatePayment: (orderId, paymentId, data = {}) =>
    api.post(`/orders/${orderId}/payments/${paymentId}/refund-duplicate`, data),
  markPaid:            (id, data = {})     => api.post(`/orders/${id}/mark-paid`, typeof data === 'string' ? { note: data } : data),
  getStatusLog:        (id)                => api.get(`/orders/${id}/log`),
  approveCancelRequest:(id)                => api.post(`/orders/${id}/approve-cancel`),
  rejectCancelRequest: (id, data)          => api.post(`/orders/${id}/reject-cancel`, data),
  approveReturnRequest:(id)                => api.post(`/orders/${id}/approve-return`),
  rejectReturnRequest: (id, data)          => api.post(`/orders/${id}/reject-return`, data),
  getOrderReturns:     (id)                => api.get(`/orders/${id}/returns`),
  adminCreatePartialReturn: (orderId, data) => api.post(`/orders/admin/${orderId}/returns`, data),
  approvePartialReturn:(returnId, data={}) => api.post(`/orders/admin/returns/${returnId}/approve`, data),
  rejectPartialReturn: (returnId, data={}) => api.post(`/orders/admin/returns/${returnId}/reject`, data),
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

// ── Coupons ───────────────────────────────────────────────────────────
export const couponsAPI = {
  getAll:     ()          => api.get('/coupons'),
  create:     (data)      => api.post('/coupons', data),
  update:     (id, data)  => api.put(`/coupons/${id}`, data),
  deactivate: (id)        => api.patch(`/coupons/${id}/deactivate`),
  remove:     (id)        => api.delete(`/coupons/${id}`),
};

// ── Deliveries & Dispatch Fleet ───────────────────────────────────────
export const deliveriesAPI = {
  getByOrder:          (orderId)              => api.get(`/deliveries/order/${orderId}`),
  getPartners:         ()                     => api.get('/deliveries/partners'),
  getRiders:           ()                     => api.get('/deliveries/riders'),
  createRider:         (data)                 => api.post('/deliveries/riders', data),
  updateRider:         (riderId, data)        => api.put(`/deliveries/riders/${riderId}`, data),
  revokeRiderLinks:    (riderId)              => api.post(`/deliveries/riders/${riderId}/revoke-links`),
  deleteRider:         (riderId, force = false) => api.delete(`/deliveries/riders/${riderId}${force ? '?force=true' : ''}`),
  removeLegacyPartner: (data)                 => api.delete('/deliveries/riders/legacy', { data }),
  create:              (data)                 => api.post('/deliveries', data),
  bulkDispatch:        (data)                 => api.post('/deliveries/bulk-dispatch', data),
  update:              (deliveryId, data)     => api.patch(`/deliveries/${deliveryId}`, data),
  simulateAdvance:     (trackingNumber)       => api.post(`/deliveries/simulate/advance/${encodeURIComponent(trackingNumber)}`),
  simulateFull:        (trackingNumber, delay) => api.post(`/deliveries/simulate/full/${encodeURIComponent(trackingNumber)}${delay ? `?delay=${delay}` : ''}`),
  sendPodOtp:          (deliveryId)           => api.post(`/deliveries/${deliveryId}/pod/send-otp`),
  createManifestLink:  (data = {})            => api.post('/deliveries/manifest/link', data),
};

// ── Product variants ──────────────────────────────────────────────────────────
export const variantsAPI = {
  getByProduct:    (productId)              => api.get(`/products/${productId}/variants`),
  create:          (productId, data)        => api.post(`/products/${productId}/variants`, data),
  update:          (productId, variantId, data) => api.put(`/products/${productId}/variants/${variantId}`, data),
  remove:          (productId, variantId)   => api.delete(`/products/${productId}/variants/${variantId}`),
  createOptionType:(productId, data)        => api.post(`/products/${productId}/option-types`, data),
  deleteOptionType:(productId, typeId)      => api.delete(`/products/${productId}/option-types/${typeId}`),
  createOptionValue:(productId, typeId, data) => api.post(`/products/${productId}/option-types/${typeId}/values`, data),
  deleteOptionValue:(productId, valueId)    => api.delete(`/products/${productId}/option-values/${valueId}`),
};

// ── Promotions ───────────────────────────────────────────────────────────────
export const promotionsAPI = {
  getAll:  (params)   => api.get('/admin/promotions', { params }),
  create:  (data)     => api.post('/admin/promotions', data),
  update:  (id, data) => api.put(`/admin/promotions/${id}`, data),
  toggle:  (id)       => api.patch(`/admin/promotions/${id}/toggle`),
  remove:  (id)       => api.delete(`/admin/promotions/${id}`),
};

// ── Newsletter ────────────────────────────────────────────────────────
export const newsletterAPI = {
  // Subscribers
  getSubscribers:    (params) => api.get('/admin/newsletter/subscribers', { params }),
  deleteSubscriber:  (id)     => api.delete(`/admin/newsletter/subscribers/${id}`),
  importSubscribers: (emails) => api.post('/admin/newsletter/subscribers/import', { emails }),

  // Campaigns
  getPreviewCount:   (segment)  => api.get('/admin/newsletter/preview-count', { params: { segment } }),
  getCampaigns:      (params)   => api.get('/admin/newsletter/campaigns', { params }),
  createCampaign:    (data)     => api.post('/admin/newsletter/campaigns', data),
  getCampaignStatus: (id)       => api.get(`/admin/newsletter/campaigns/${id}/status`),
  sendCampaign:      (id)       => api.post(`/admin/newsletter/campaigns/${id}/send`),
  getCampaignById:   (id)       => api.get(`/admin/newsletter/campaigns/${id}`),
};

export default api;

const express = require('express');
const { verifyToken, requireAdmin, requireRoles }      = require('../middleware/auth');
const { uploadMiddleware, uploadSingleMediaMiddleware } = require('../middleware/uploadFilter');
const {
  getDashboard, getAnalytics, getFinancials, getTopProducts, getInventoryOverview, getAllCustomers,
  getAdminAccounts, createAdminAccount, updateAdminRole, deactivateAdminAccount, activateAdminAccount, getAuditLogs,
  uploadProductImages, uploadGenericMedia, deleteProductImage, reorderProductImages, setPrimaryProductImage,
  omnisearch,
} = require('../controllers/admin.controller');
const {
  getAllReviews, getReviewCounts, approveReview, rejectReview, deleteReview,
} = require('../controllers/review.controller');
const {
  getSubscribers, deleteSubscriber, importSubscribers,
  getPreviewCount, createCampaign, sendCampaign,
  getCampaignStatus, getCampaigns, getCampaignById,
} = require('../controllers/newsletter.controller');
const {
  getPromotions, createPromotion, updatePromotion, togglePromotion, deletePromotion,
} = require('../controllers/promotions.controller');

const router = express.Router();

const requireSuperOrAdmin = requireRoles('admin', 'super_admin');
const requireSuperAdminOnly = requireRoles('super_admin');
const requireSupportOrAdmin = requireRoles('admin', 'super_admin', 'support');
const requireMarketingOrAdmin = requireRoles('admin', 'super_admin', 'marketing');
const requireFulfillmentOrAdmin = requireRoles('admin', 'super_admin', 'fulfillment');

// ── Existing routes ───────────────────────────────────────────────────────────
router.get('/omnisearch',    verifyToken, requireAdmin, omnisearch);
router.get('/dashboard',     verifyToken, requireAdmin, getDashboard);
router.get('/analytics',     verifyToken, requireAdmin, getAnalytics);
router.get('/financials',    verifyToken, requireAdmin, requireSuperOrAdmin, getFinancials);
router.get('/top-products',  verifyToken, requireAdmin, getTopProducts);
router.get('/inventory',     verifyToken, requireAdmin, requireFulfillmentOrAdmin, getInventoryOverview);
router.get('/customers',     verifyToken, requireAdmin, requireSuperOrAdmin, getAllCustomers);
// Review management — /counts must be before /:id to avoid being swallowed
router.get('/reviews/counts',        verifyToken, requireAdmin, requireSupportOrAdmin, getReviewCounts);
router.get('/reviews',               verifyToken, requireAdmin, requireSupportOrAdmin, getAllReviews);
router.patch('/reviews/:id/approve', verifyToken, requireAdmin, requireSupportOrAdmin, approveReview);
router.patch('/reviews/:id/reject',  verifyToken, requireAdmin, requireSupportOrAdmin, rejectReview);
router.delete('/reviews/:id',        verifyToken, requireAdmin, requireSupportOrAdmin, deleteReview);

// ── Admin account management & audit logs ─────────────────────────────────────
router.get('/accounts',                       verifyToken, requireAdmin, requireSuperOrAdmin, getAdminAccounts);
router.post('/accounts',                      verifyToken, requireAdmin, requireSuperOrAdmin, createAdminAccount);
router.patch('/accounts/:id/role',            verifyToken, requireAdmin, requireSuperAdminOnly, updateAdminRole);
router.patch('/accounts/:id/deactivate',      verifyToken, requireAdmin, requireSuperOrAdmin, deactivateAdminAccount);
router.patch('/accounts/:id/activate',        verifyToken, requireAdmin, requireSuperOrAdmin, activateAdminAccount);
router.get('/audit-logs',                     verifyToken, requireAdmin, requireSuperOrAdmin, getAuditLogs);

// ── Product & General media image routes ──────────────────────────────────────
router.post(
  '/media/upload',
  verifyToken, requireAdmin, requireMarketingOrAdmin, uploadSingleMediaMiddleware,
  uploadGenericMedia
);
router.post(
  '/products/:id/images',
  verifyToken, requireAdmin, requireMarketingOrAdmin, uploadMiddleware,
  uploadProductImages
);
router.delete(
  '/products/:id/images/:imageId',
  verifyToken, requireAdmin, requireMarketingOrAdmin,
  deleteProductImage
);
router.put(
  '/products/:id/images/reorder',
  verifyToken, requireAdmin, requireMarketingOrAdmin,
  reorderProductImages
);
router.patch(
  '/products/:id/images/:imageId/primary',
  verifyToken, requireAdmin, requireMarketingOrAdmin,
  setPrimaryProductImage
);

// ── Newsletter: subscriber management (PII) & campaigns ───────────────────────
router.get('/newsletter/subscribers',          verifyToken, requireAdmin, requireSuperOrAdmin, getSubscribers);
router.delete('/newsletter/subscribers/:id',   verifyToken, requireAdmin, requireSuperOrAdmin, deleteSubscriber);
router.post('/newsletter/subscribers/import',  verifyToken, requireAdmin, requireSuperOrAdmin, importSubscribers);

// ── Newsletter: campaign management ──────────────────────────────────────────
router.get('/newsletter/preview-count',            verifyToken, requireAdmin, requireMarketingOrAdmin, getPreviewCount);
router.get('/newsletter/campaigns',                verifyToken, requireAdmin, requireMarketingOrAdmin, getCampaigns);
router.post('/newsletter/campaigns',               verifyToken, requireAdmin, requireMarketingOrAdmin, createCampaign);
router.get('/newsletter/campaigns/:id/status',     verifyToken, requireAdmin, requireMarketingOrAdmin, getCampaignStatus);
router.post('/newsletter/campaigns/:id/send',      verifyToken, requireAdmin, requireMarketingOrAdmin, sendCampaign);
router.get('/newsletter/campaigns/:id',            verifyToken, requireAdmin, requireMarketingOrAdmin, getCampaignById);

// ── Promotions ────────────────────────────────────────────────────────────────
router.get('/promotions',             verifyToken, requireAdmin, requireMarketingOrAdmin, getPromotions);
router.post('/promotions',            verifyToken, requireAdmin, requireMarketingOrAdmin, createPromotion);
router.put('/promotions/:id',         verifyToken, requireAdmin, requireMarketingOrAdmin, updatePromotion);
router.patch('/promotions/:id/toggle',verifyToken, requireAdmin, requireMarketingOrAdmin, togglePromotion);
router.delete('/promotions/:id',      verifyToken, requireAdmin, requireMarketingOrAdmin, deletePromotion);

module.exports = router;

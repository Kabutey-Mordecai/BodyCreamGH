const express = require('express');
const { verifyToken, requireAdmin }    = require('../middleware/auth');
const { uploadMiddleware }             = require('../middleware/uploadFilter');
const {
  getDashboard, getAnalytics, getFinancials, getTopProducts, getInventoryOverview, getAllCustomers,
  getAdminAccounts, createAdminAccount, deactivateAdminAccount, activateAdminAccount,
  uploadProductImages, deleteProductImage, reorderProductImages, setPrimaryProductImage,
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

// ── Existing routes ───────────────────────────────────────────────────────────
router.get('/dashboard',     verifyToken, requireAdmin, getDashboard);
router.get('/analytics',     verifyToken, requireAdmin, getAnalytics);
router.get('/financials',    verifyToken, requireAdmin, getFinancials);
router.get('/top-products',  verifyToken, requireAdmin, getTopProducts);
router.get('/inventory',     verifyToken, requireAdmin, getInventoryOverview);
router.get('/customers',     verifyToken, requireAdmin, getAllCustomers);
// Review management — /counts must be before /:id to avoid being swallowed
router.get('/reviews/counts',        verifyToken, requireAdmin, getReviewCounts);
router.get('/reviews',               verifyToken, requireAdmin, getAllReviews);
router.patch('/reviews/:id/approve', verifyToken, requireAdmin, approveReview);
router.patch('/reviews/:id/reject',  verifyToken, requireAdmin, rejectReview);
router.delete('/reviews/:id',        verifyToken, requireAdmin, deleteReview);

// ── Admin account management ──────────────────────────────────────────────────
router.get('/accounts',                       verifyToken, requireAdmin, getAdminAccounts);
router.post('/accounts',                      verifyToken, requireAdmin, createAdminAccount);
router.patch('/accounts/:id/deactivate',      verifyToken, requireAdmin, deactivateAdminAccount);
router.patch('/accounts/:id/activate',        verifyToken, requireAdmin, activateAdminAccount);

// ── Product image routes ──────────────────────────────────────────────────────
// Auth runs before multer so unauthenticated requests are rejected without
// reading file data into memory.
router.post(
  '/products/:id/images',
  verifyToken, requireAdmin, uploadMiddleware,
  uploadProductImages
);
router.delete(
  '/products/:id/images/:imageId',
  verifyToken, requireAdmin,
  deleteProductImage
);
router.put(
  '/products/:id/images/reorder',
  verifyToken, requireAdmin,
  reorderProductImages
);
router.patch(
  '/products/:id/images/:imageId/primary',
  verifyToken, requireAdmin,
  setPrimaryProductImage
);

// ── Newsletter: subscriber management ────────────────────────────────────────
router.get('/newsletter/subscribers',          verifyToken, requireAdmin, getSubscribers);
router.delete('/newsletter/subscribers/:id',   verifyToken, requireAdmin, deleteSubscriber);
router.post('/newsletter/subscribers/import',  verifyToken, requireAdmin, importSubscribers);

// ── Newsletter: campaign management ──────────────────────────────────────────
router.get('/newsletter/preview-count',            verifyToken, requireAdmin, getPreviewCount);
router.get('/newsletter/campaigns',                verifyToken, requireAdmin, getCampaigns);
router.post('/newsletter/campaigns',               verifyToken, requireAdmin, createCampaign);
router.get('/newsletter/campaigns/:id/status',     verifyToken, requireAdmin, getCampaignStatus);
router.post('/newsletter/campaigns/:id/send',      verifyToken, requireAdmin, sendCampaign);
router.get('/newsletter/campaigns/:id',            verifyToken, requireAdmin, getCampaignById);

// ── Promotions ────────────────────────────────────────────────────────────────
router.get('/promotions',             verifyToken, requireAdmin, getPromotions);
router.post('/promotions',            verifyToken, requireAdmin, createPromotion);
router.put('/promotions/:id',         verifyToken, requireAdmin, updatePromotion);
router.patch('/promotions/:id/toggle',verifyToken, requireAdmin, togglePromotion);
router.delete('/promotions/:id',      verifyToken, requireAdmin, deletePromotion);

module.exports = router;

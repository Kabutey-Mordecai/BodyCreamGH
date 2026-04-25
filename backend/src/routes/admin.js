const express = require('express');
const multer  = require('multer');
const { verifyToken, requireAdmin }    = require('../middleware/auth');
const {
  getDashboard, getAnalytics, getTopProducts, getInventoryOverview, getAllCustomers,
  uploadProductImages, deleteProductImage, reorderProductImages, setPrimaryProductImage,
} = require('../controllers/admin.controller');
const { getAllReviews, deleteReview } = require('../controllers/review.controller');

const router = express.Router();

// ── Multer — memory storage, applied per-route on the upload endpoint ─────────
const MAX_FILES_PER_REQUEST = 8; // multer hard ceiling; per-product limit enforced in controller

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,   // 5 MB per file
    files: MAX_FILES_PER_REQUEST,
  },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Only JPG, PNG, and WebP images are allowed'));
    }
    cb(null, true);
  },
});

// Wraps upload.array with typed error handling for multer validation failures
function uploadMiddleware(req, res, next) {
  upload.array('images')(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Image file too large. Maximum size is 5MB.' });
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ error: `Too many files. Maximum ${MAX_FILES_PER_REQUEST} files per upload.` });
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: "Unexpected field. Use the 'images' field name for uploads." });
      }
    }

    // fileFilter rejection or any other upload error
    return res.status(400).json({ error: err.message });
  });
}

// ── Existing routes ───────────────────────────────────────────────────────────
router.get('/dashboard',     verifyToken, requireAdmin, getDashboard);
router.get('/analytics',     verifyToken, requireAdmin, getAnalytics);
router.get('/top-products',  verifyToken, requireAdmin, getTopProducts);
router.get('/inventory',     verifyToken, requireAdmin, getInventoryOverview);
router.get('/customers',     verifyToken, requireAdmin, getAllCustomers);
router.get('/reviews',       verifyToken, requireAdmin, getAllReviews);
router.delete('/reviews/:reviewId', verifyToken, requireAdmin, deleteReview);

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

module.exports = router;

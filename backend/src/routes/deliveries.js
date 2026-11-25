const express = require('express');
const { verifyToken, requireAdmin, requireRoles } = require('../middleware/auth');
const requireFulfillmentOrAdmin = requireRoles('super_admin', 'admin', 'fulfillment');
const { makeRateLimiter } = require('../middleware/rateLimit');
const { validateCreateDelivery, validateUpdateDelivery } = require('../middleware/validation');
const { uploadSingleMediaMiddleware } = require('../middleware/uploadFilter');
const { uploadGenericMedia } = require('../controllers/admin.controller');
const {
  createDelivery,
  bulkDispatch,
  trackShipment,
  getDeliveryByOrder,
  updateDelivery,
  sendPodOtp,
  getRiderHandoff,
  confirmRiderDelivery,
  confirmCustomerReceipt,
  requireRiderToken,
  getDeliveryPartners,
  listRiders,
  createRider,
  updateRider,
  revokeRiderLinks,
  deleteRider,
  removeLegacyPartner,
  createRiderManifestLink,
  getRiderManifest,
  riderResendPodOtp,
} = require('../controllers/delivery.controller');
const { advanceShipment, simulateFullJourney } = require('../services/courier.service');

const router = express.Router();

// ── Dedicated Rate Limiters for Public & Signed Rider Endpoints ───────────────
const trackRateLimiter = makeRateLimiter(
  15 * 60 * 1000,
  60,
  'Too many tracking lookups. Please wait a few minutes and try again.'
);

const riderReadLimiter = makeRateLimiter(
  15 * 60 * 1000,
  120,
  'Too many route refreshes. Please wait a moment before syncing again.'
);

const riderResendOtpLimiter = makeRateLimiter(
  15 * 60 * 1000,
  10,
  'Too many delivery code resend requests. Please wait a few minutes or contact Dispatch.'
);

const riderPhotoLimiter = makeRateLimiter(
  15 * 60 * 1000,
  20,
  'Too many parcel photo uploads. Please wait a few minutes before retrying.',
  {
    keyGenerator: (req, ip) => (req.rider?.sub ? `pod:photo:${req.rider.sub}` : `pod:photo:ip:${ip}`),
  }
);

const riderConfirmLimiter = makeRateLimiter(
  15 * 60 * 1000,
  15,
  'Too many verification attempts from this device. Please wait 15 minutes or contact Dispatch.'
);

// ── Public — rate-limited tracking lookup ─────────────────────────────────────
router.get('/track/:tracking_number', trackRateLimiter, trackShipment);

// ── Signed Rider Proof-of-Delivery & Multi-Stop Manifest endpoints ────────────
router.get('/rider/manifest',    riderReadLimiter, getRiderManifest);
router.post('/rider/resend-otp', riderResendOtpLimiter, riderResendPodOtp);
router.get('/rider/handoff',     riderReadLimiter, getRiderHandoff);
router.post('/rider/photo',      requireRiderToken, riderPhotoLimiter, uploadSingleMediaMiddleware, uploadGenericMedia);
router.post('/rider/confirm',    riderConfirmLimiter, confirmRiderDelivery);

// ── Authenticated ─────────────────────────────────────────────────────────────
router.get('/partners',                         verifyToken, requireAdmin, requireFulfillmentOrAdmin, getDeliveryPartners);
router.get('/riders',                           verifyToken, requireAdmin, requireFulfillmentOrAdmin, listRiders);
router.post('/riders',                          verifyToken, requireAdmin, requireFulfillmentOrAdmin, createRider);
router.delete('/riders/legacy',                 verifyToken, requireAdmin, requireFulfillmentOrAdmin, removeLegacyPartner);
router.put('/riders/:riderId',                  verifyToken, requireAdmin, requireFulfillmentOrAdmin, updateRider);
router.post('/riders/:riderId/revoke-links',    verifyToken, requireAdmin, requireFulfillmentOrAdmin, revokeRiderLinks);
router.delete('/riders/:riderId',               verifyToken, requireAdmin, requireFulfillmentOrAdmin, deleteRider);
router.post('/bulk-dispatch',                   verifyToken, requireAdmin, requireFulfillmentOrAdmin, bulkDispatch);
router.post('/',                                verifyToken, requireAdmin, requireFulfillmentOrAdmin, validateCreateDelivery, createDelivery);
router.post('/manifest/link',                   verifyToken, requireAdmin, requireFulfillmentOrAdmin, createRiderManifestLink);
router.get('/order/:orderId',                   verifyToken, getDeliveryByOrder);
router.post('/order/:orderId/confirm-receipt',  verifyToken, confirmCustomerReceipt);
router.patch('/:deliveryId',                    verifyToken, requireAdmin, requireFulfillmentOrAdmin, validateUpdateDelivery, updateDelivery);
router.post('/:deliveryId/pod/send-otp',        verifyToken, requireAdmin, requireFulfillmentOrAdmin, sendPodOtp);

// ── Admin: courier stage progression endpoints ────────────────────────────────
router.post('/simulate/advance/:tracking_number', verifyToken, requireAdmin, requireFulfillmentOrAdmin, async (req, res) => {
  try {
    const result = await advanceShipment(req.params.tracking_number);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/simulate/full/:tracking_number', verifyToken, requireAdmin, requireFulfillmentOrAdmin, async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Automated demo shipment simulation is disabled in production.' });
  }
  const delayMs = Math.max(1000, parseInt(req.query.delay) || 2000);
  res.json({ message: `Full simulation started for ${req.params.tracking_number}`, delayMs });
  simulateFullJourney(req.params.tracking_number, delayMs);
});

module.exports = router;

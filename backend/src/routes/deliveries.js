const express = require('express');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { validateCreateDelivery, validateUpdateDelivery } = require('../middleware/validation');
const { uploadSingleMediaMiddleware } = require('../middleware/uploadFilter');
const { uploadGenericMedia } = require('../controllers/admin.controller');
const {
  createDelivery,
  trackShipment,
  getDeliveryByOrder,
  updateDelivery,
  sendPodOtp,
  getRiderHandoff,
  confirmRiderDelivery,
  confirmCustomerReceipt,
  requireRiderToken,
  getDeliveryPartners,
  createRiderManifestLink,
  getRiderManifest,
  riderResendPodOtp,
} = require('../controllers/delivery.controller');
const { advanceShipment, simulateFullJourney } = require('../services/courier.service');

const router = express.Router();

// ── Public — no auth needed ───────────────────────────────────────────────────
router.get('/track/:tracking_number', trackShipment);

// ── Signed Rider Proof-of-Delivery & Multi-Stop Manifest endpoints ────────────
router.get('/rider/manifest',    getRiderManifest);
router.post('/rider/resend-otp', riderResendPodOtp);
router.get('/rider/handoff',     getRiderHandoff);
router.post('/rider/photo',      requireRiderToken, uploadSingleMediaMiddleware, uploadGenericMedia);
router.post('/rider/confirm',    confirmRiderDelivery);

// ── Authenticated ─────────────────────────────────────────────────────────────
router.get('/partners',                         verifyToken, requireAdmin, getDeliveryPartners);
router.post('/',                                verifyToken, requireAdmin, validateCreateDelivery, createDelivery);
router.post('/manifest/link',                   verifyToken, requireAdmin, createRiderManifestLink);
router.get('/order/:orderId',                   verifyToken, getDeliveryByOrder);
router.post('/order/:orderId/confirm-receipt',  verifyToken, confirmCustomerReceipt);
router.patch('/:deliveryId',                    verifyToken, requireAdmin, validateUpdateDelivery, updateDelivery);
router.post('/:deliveryId/pod/send-otp',        verifyToken, requireAdmin, sendPodOtp);

// ── Admin: courier stage progression endpoints ────────────────────────────────
router.post('/simulate/advance/:tracking_number', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await advanceShipment(req.params.tracking_number);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/simulate/full/:tracking_number', verifyToken, requireAdmin, async (req, res) => {
  const delayMs = Math.max(1000, parseInt(req.query.delay) || 2000);
  res.json({ message: `Full simulation started for ${req.params.tracking_number}`, delayMs });
  simulateFullJourney(req.params.tracking_number, delayMs);
});

module.exports = router;

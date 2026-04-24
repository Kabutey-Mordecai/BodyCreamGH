const express = require('express');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { validateCreateDelivery, validateUpdateDelivery } = require('../middleware/validation');
const {
  createDelivery,
  trackShipment,
  getDeliveryByOrder,
  updateDelivery,
} = require('../controllers/delivery.controller');
const { advanceShipment, simulateFullJourney } = require('../services/courier.service');

const router = express.Router();

// ── Public — no auth needed ───────────────────────────────────────────────────
// Anyone with the tracking number can check status (mirrors real courier APIs)
router.get('/track/:tracking_number', trackShipment);

// ── Authenticated ─────────────────────────────────────────────────────────────
router.post('/',              verifyToken, requireAdmin, validateCreateDelivery, createDelivery);
router.get('/order/:orderId', verifyToken, getDeliveryByOrder);
router.patch('/:deliveryId',  verifyToken, requireAdmin, validateUpdateDelivery, updateDelivery);

// ── Admin: courier simulation endpoints ──────────────────────────────────────
// Advance one step: pending → in_transit → out_for_delivery → delivered
router.post('/simulate/advance/:tracking_number', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await advanceShipment(req.params.tracking_number);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Fire-and-forget: simulate the full journey automatically (each step after delayMs)
router.post('/simulate/full/:tracking_number', verifyToken, requireAdmin, async (req, res) => {
  const delayMs = Math.max(1000, parseInt(req.query.delay) || 2000);
  res.json({ message: `Full simulation started for ${req.params.tracking_number}`, delayMs });
  simulateFullJourney(req.params.tracking_number, delayMs); // runs in background
});

module.exports = router;

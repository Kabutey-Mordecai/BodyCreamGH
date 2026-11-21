const express = require('express');
const { verifyToken, requireAdmin, requireRoles } = require('../middleware/auth');
const { getInventory, restockProduct, getHistory, getLowStock, adjustInventory } = require('../controllers/inventory.controller');

const router = express.Router();
const requireFulfillmentOrAdmin = requireRoles('admin', 'super_admin', 'fulfillment');

router.get('/', verifyToken, requireAdmin, requireFulfillmentOrAdmin, getInventory);
router.post('/restock', verifyToken, requireAdmin, requireFulfillmentOrAdmin, restockProduct);
router.get('/low-stock', verifyToken, requireAdmin, requireFulfillmentOrAdmin, getLowStock);
router.get('/history', verifyToken, requireAdmin, requireFulfillmentOrAdmin, getHistory);
router.get('/history/:productId', verifyToken, requireAdmin, requireFulfillmentOrAdmin, getHistory);
router.get('/:productId/history', verifyToken, requireAdmin, requireFulfillmentOrAdmin, getHistory);
router.post('/:productId/adjust', verifyToken, requireAdmin, requireFulfillmentOrAdmin, adjustInventory);

module.exports = router;

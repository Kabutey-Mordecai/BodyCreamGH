const express = require('express');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { getInventory, restockProduct, getHistory, getLowStock, adjustInventory } = require('../controllers/inventory.controller');

const router = express.Router();

router.get('/', verifyToken, requireAdmin, getInventory);
router.post('/restock', verifyToken, requireAdmin, restockProduct);
router.get('/low-stock', verifyToken, requireAdmin, getLowStock);
router.get('/history', verifyToken, requireAdmin, getHistory);
router.get('/history/:productId', verifyToken, requireAdmin, getHistory);

// Paths expected by admin frontend
router.get('/:productId/history', verifyToken, requireAdmin, getHistory);
router.post('/:productId/adjust', verifyToken, requireAdmin, adjustInventory);

module.exports = router;

const express = require('express');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { createDelivery, getDeliveryByOrder, updateDelivery } = require('../controllers/delivery.controller');

const router = express.Router();

router.post('/',                          verifyToken, requireAdmin, createDelivery);
router.get('/order/:orderId',             verifyToken, getDeliveryByOrder);
router.patch('/:deliveryId',              verifyToken, requireAdmin, updateDelivery);

module.exports = router;

const express = require('express');
const { getActivePromotions } = require('../controllers/promotions.controller');

const router = express.Router();

// Public — storefront reads active promotions embedded in product responses,
// but this endpoint is available for a dedicated "Deals" page if needed.
router.get('/active', getActivePromotions);

module.exports = router;

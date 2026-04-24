const express = require('express');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { getAllSettings, upsertSetting, upsertManySettings } = require('../controllers/settings.controller');

const router = express.Router();

// Public — storefront reads all settings on load
router.get('/', getAllSettings);

// Admin-only writes
router.put('/', verifyToken, requireAdmin, upsertSetting);
router.put('/bulk', verifyToken, requireAdmin, upsertManySettings);

module.exports = router;

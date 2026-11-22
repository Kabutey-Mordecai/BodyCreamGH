const express = require('express');
const { verifyToken, requireAdmin, requireRoles } = require('../middleware/auth');
const { getAllSettings, upsertSetting, upsertManySettings } = require('../controllers/settings.controller');

const router = express.Router();
const requireSuperOrAdmin = requireRoles('admin', 'super_admin');

// Public — storefront reads all settings on load
router.get('/', getAllSettings);

// Admin/Super-Admin only writes
router.put('/', verifyToken, requireAdmin, requireSuperOrAdmin, upsertSetting);
router.put('/bulk', verifyToken, requireAdmin, requireSuperOrAdmin, upsertManySettings);

module.exports = router;

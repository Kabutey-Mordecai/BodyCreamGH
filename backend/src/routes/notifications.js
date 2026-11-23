'use strict';

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const notificationService = require('../services/notification.service');

// POST /api/notifications/register-device (authenticated)
// Registers or updates an FCM push token for the current user's device
router.post('/register-device', verifyToken, async (req, res) => {
  try {
    const { fcm_token, platform, device_name } = req.body;
    if (!fcm_token) {
      return res.status(400).json({ error: 'fcm_token is required' });
    }

    const device = await notificationService.registerDeviceToken({
      userId: req.user.id,
      fcmToken: fcm_token,
      platform: platform || 'android',
      deviceName: device_name || '',
    });

    res.json({ message: 'Device token registered', device });
  } catch (err) {
    res.status(500).json({ error: 'Failed to register device token' });
  }
});

module.exports = router;

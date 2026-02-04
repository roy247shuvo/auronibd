const express = require('express');
const router = express.Router();
const trackingController = require('../controllers/trackingController');

// 1. GET Result Page (Must be BEFORE the :id route to avoid conflict)
router.get('/track/result', trackingController.getTrackResult);

// 2. GET Page (Optional ID for sharing link)
router.get('/track/:id?', trackingController.getTrackPage);

// 3. POST Search Action
router.post('/track', trackingController.postTrackOrder);

module.exports = router;
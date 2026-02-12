const express = require('express');
const router = express.Router();
const controller = require('../controllers/gamificationController');
const { isAdmin } = require('../middleware/authMiddleware'); // Assuming you have this

// Admin Routes
router.get('/admin/gamification/participants', isAdmin, controller.getParticipants);
router.get('/admin/gamification/settings', isAdmin, controller.getSettings);

// Public API Routes
router.get('/api/gamification/target', controller.getTargetUrl);
router.post('/api/gamification/submit', controller.submitWinner);

module.exports = router;
const express = require('express');
const router = express.Router();
const controller = require('../controllers/gamificationController');

// Middleware to check Admin
const isAdmin = (req, res, next) => {
    if (!req.session || !req.session.user) return res.redirect('/login');
    if (req.session.user.role === 'admin') return next();
    res.status(403).send("Access Denied");
};

// Admin Routes
router.get('/admin/gamification/participants', isAdmin, controller.getParticipants);
router.post('/admin/gamification/status', isAdmin, controller.toggleStatus); // ON/OFF
router.post('/admin/gamification/draw', isAdmin, controller.drawWinner);     // Draw Winner
router.get('/api/gamification/history/:id', isAdmin, controller.getHistoryDetails); // History Modal Data

// Public API Routes
router.get('/api/gamification/target', controller.getTargetUrl);
router.post('/api/gamification/submit', controller.submitWinner);

module.exports = router;
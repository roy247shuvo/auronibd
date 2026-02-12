const express = require('express');
const router = express.Router();
const controller = require('../controllers/gamificationController');

// [FIX] Define isAdmin here so we don't need an extra file
const isAdmin = (req, res, next) => {
    // 1. Check if user is logged in
    if (!req.session || !req.session.user) {
        return res.redirect('/login');
    }
    // 2. Check if user is Admin
    if (req.session.user.role === 'admin') {
        return next();
    }
    // 3. Deny access if not admin
    res.status(403).send("Access Denied: Admins only.");
};

// Admin Routes
router.get('/admin/gamification/participants', isAdmin, controller.getParticipants);
router.get('/admin/gamification/settings', isAdmin, controller.getSettings);
router.post('/admin/gamification/settings', isAdmin, controller.saveSettings); // [NEW] Save Route

// Public API Routes
router.get('/api/gamification/target', controller.getTargetUrl);
router.post('/api/gamification/submit', controller.submitWinner);

module.exports = router;
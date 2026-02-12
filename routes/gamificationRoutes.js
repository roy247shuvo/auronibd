const express = require('express');
const router = express.Router();
const controller = require('../controllers/gamificationController');

// [FIX] Define Admin Check Locally (No extra file needed)
const isAdmin = (req, res, next) => {
    if (req.session && req.session.user && req.session.user.role === 'admin') {
        return next();
    }
    // If not admin, redirect to login or show error
    res.redirect('/login');
};

// Admin Routes
router.get('/admin/gamification/participants', isAdmin, controller.getParticipants);
router.get('/admin/gamification/settings', isAdmin, controller.getSettings);

// Public API Routes
router.get('/api/gamification/target', controller.getTargetUrl);
router.post('/api/gamification/submit', controller.submitWinner);

module.exports = router;
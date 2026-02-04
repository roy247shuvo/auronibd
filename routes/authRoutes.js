const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
// NEW: Import the Shop Auth Controller
const shopAuthController = require('../controllers/shopAuthController');

// --- Admin Routes (Existing) ---
router.get('/login', authController.getLoginPage);
router.post('/login', authController.login);
router.get('/logout', authController.logout);

// --- NEW: Customer Login Routes (Frontend) ---
router.post('/customer/google-login', express.json(), shopAuthController.googleLogin);
router.post('/customer/verify-phone', express.json(), shopAuthController.verifyPhone);
router.post('/customer/link', express.json(), shopAuthController.linkCustomer);
router.post('/customer/create', express.json(), shopAuthController.createCustomer);
router.get('/customer/logout', shopAuthController.logout);

// Change Password Route (AJAX)
router.post('/admin/change-password-api', authController.changeOwnPassword);

module.exports = router;
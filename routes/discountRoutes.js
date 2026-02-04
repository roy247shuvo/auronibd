const express = require('express');
const router = express.Router();
const discountController = require('../controllers/discountController');
const checkPermission = require('../middleware/permissionMiddleware'); // Added

// Coupons
router.get('/coupons', checkPermission('disc_coupons'), discountController.getCoupons);
router.get('/coupons/usage', checkPermission('disc_coupons'), discountController.getCouponUsage);

// Credits
router.get('/credits', checkPermission('disc_credits'), discountController.getCredits);
router.get('/credits/usage', checkPermission('disc_credits'), discountController.getCreditUsage);

module.exports = router;
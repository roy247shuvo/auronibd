const express = require('express');
const router = express.Router();
const posController = require('../controllers/posController');
const authController = require('../controllers/authController');
const checkPermission = require('../middleware/permissionMiddleware'); // Added

// Standard View (Terminal Access)
router.get('/', authController.isLoggedIn, checkPermission('pos_terminal'), posController.getPOS);

// Sale History (Separate Permission)
router.get('/history', authController.isLoggedIn, checkPermission('pos_history'), posController.getPosHistory);

// NEW: POS Settings (Separate Permission)
router.get('/pos-setting', authController.isLoggedIn, checkPermission('pos_setting'), posController.getPosSettings);
router.post('/pos-setting', authController.isLoggedIn, checkPermission('pos_setting'), posController.savePosSettings);

// Full Screen View
router.get('/fullscreen', authController.isLoggedIn, checkPermission('pos_terminal'), posController.getPOSFullscreen);

// APIs
router.get('/search', authController.isLoggedIn, checkPermission('pos_terminal'), posController.searchProducts);
router.get('/variants/:id', authController.isLoggedIn, checkPermission('pos_terminal'), posController.getVariants); 
router.get('/order-details/:id', authController.isLoggedIn, checkPermission('pos_terminal'), posController.getOrderDetails);
router.get('/customer', authController.isLoggedIn, checkPermission('pos_terminal'), posController.getCustomer);
router.get('/customer-history', authController.isLoggedIn, checkPermission('pos_terminal'), posController.getCustomerHistory);
router.post('/submit', authController.isLoggedIn, checkPermission('pos_terminal'), posController.submitOrder);
router.get('/receipt/:id', authController.isLoggedIn, checkPermission('pos_terminal'), posController.getReceipt);

// Stock Reservation Routes
router.post('/hold-stock', authController.isLoggedIn, checkPermission('pos_terminal'), posController.holdStock);
router.post('/release-stock', authController.isLoggedIn, checkPermission('pos_terminal'), posController.releaseStock);
router.post('/clear-holds', authController.isLoggedIn, checkPermission('pos_terminal'), posController.clearHolds);

module.exports = router;
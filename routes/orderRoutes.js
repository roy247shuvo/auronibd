const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const checkPermission = require('../middleware/permissionMiddleware'); // Added
const returnController = require('../controllers/returnController');
const authController = require('../controllers/authController');

// Main Page
router.get('/web-orders', checkPermission('orders_web'), orderController.getWebOrders);

// API: Search Products for Manual Order
router.get('/search-products', checkPermission('orders_web'), orderController.searchProducts);

// API: Check Customer History
router.get('/check-customer', checkPermission('orders_web'), orderController.checkCustomer); 

// Action: Create Manual Order
router.post('/create-order', checkPermission('orders_web'), orderController.createManualOrder);

// --- MISSING ROUTE ADDED HERE ---
router.post('/update-order', checkPermission('orders_web'), orderController.updateOrder);

// Action: Update Status
router.post('/update-status', checkPermission('orders_web'), orderController.updateStatus);

router.post('/bulk-update-status', checkPermission('orders_web'), orderController.bulkUpdateStatus);
router.post('/send-to-steadfast', checkPermission('orders_web'), orderController.sendToSteadfast);
router.get('/print-labels', checkPermission('orders_web'), orderController.printLabels);
router.get('/label-settings', checkPermission('orders_label'), orderController.getLabelSettings);

// --- STEADFAST PARTIAL RETURNS MANAGER ---
// checkPermission handles authentication check automatically
router.get('/returns', checkPermission('orders_return'), returnController.getReturnsPage);
router.get('/returns/items/:order_id', checkPermission('orders_return'), returnController.getOrderItems);
router.post('/returns/process', checkPermission('orders_return'), returnController.processRestock);

module.exports = router;
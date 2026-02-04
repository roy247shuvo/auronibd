const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');
const checkPermission = require('../middleware/permissionMiddleware');

// List & Search
router.get('/', checkPermission('cust_list'), customerController.getCustomers);

// View Profile
router.get('/view/:id', checkPermission('cust_list'), customerController.getCustomerView);

// Update Profile
router.post('/update', checkPermission('cust_list'), customerController.updateCustomer);

// API for Modal
router.get('/api/order/:id', checkPermission('cust_list'), customerController.getOrderDetailsApi);

module.exports = router;
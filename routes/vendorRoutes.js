const express = require('express');
const router = express.Router();
const vendorController = require('../controllers/vendorController');
const checkPermission = require('../middleware/permissionMiddleware'); // Added

// List Vendors (Controller: getVendorList)
router.get('/', checkPermission('vend_list'), vendorController.getVendorList);

// Create Vendor (Controller: addVendor)
router.post('/create', checkPermission('vend_list'), vendorController.addVendor);

// Update Vendor (Controller: editVendor)
router.post('/update', checkPermission('vend_list'), vendorController.editVendor);

// Delete Vendor (Controller: deleteVendor)
router.get('/delete/:id', checkPermission('vend_list'), vendorController.deleteVendor);

// Vendor Details (Controller: getVendorDetails)
router.get('/details/:id', checkPermission('vend_list'), vendorController.getVendorDetails);

// Purchase History (Controller: getVendorHistory)
router.get('/history/:id', checkPermission('vend_list'), vendorController.getVendorHistory);

module.exports = router;
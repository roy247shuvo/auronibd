const express = require('express');
const router = express.Router();
const productSettingController = require('../controllers/productSettingController');
const checkPermission = require('../middleware/permissionMiddleware'); // Added
const multer = require('multer');
const { storage } = require('../config/cloudinary');
const upload = multer({ storage: storage });

// Routes
router.get('/settings', checkPermission('prod_settings'), productSettingController.getSettingsPage);
// Check permission BEFORE processing the file upload
router.post('/save-item', checkPermission('prod_settings'), upload.single('logo'), productSettingController.saveItem);

module.exports = router;
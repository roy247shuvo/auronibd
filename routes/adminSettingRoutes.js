const express = require('express');
const router = express.Router();
const checkPermission = require('../middleware/permissionMiddleware'); // CORRECT IMPORT

// Import Controllers
const adminSettingController = require('../controllers/adminSettingController');
const userSettingController = require('../controllers/userSettingController');
const smtpSettingController = require('../controllers/smtpSettingController');
const analyticsSettingController = require('../controllers/analyticsSettingController');

// 1. General Settings
router.get('/general', checkPermission('set_general'), adminSettingController.getGeneralSettings);
router.post('/general', checkPermission('set_general'), adminSettingController.saveGeneralSettings);

// 2. Store Details
router.get('/store', checkPermission('set_store'), adminSettingController.getStoreSettings);
router.post('/store', checkPermission('set_store'), adminSettingController.saveStoreSettings);

// 3. Users & Roles
router.get('/users', checkPermission('set_users'), userSettingController.getUsers);
router.get('/users/add', checkPermission('set_users'), userSettingController.getAddUser);
router.get('/users/edit/:id', checkPermission('set_users'), userSettingController.getEditUser);
router.post('/users/save', checkPermission('set_users'), userSettingController.saveUser);

// 4. SMTP & SMS
router.get('/smtp', checkPermission('set_smtp'), smtpSettingController.getSMTPSettings);
router.post('/smtp', checkPermission('set_smtp'), smtpSettingController.saveSMTPSettings);

// 5. Meta Pixel & Analytics
router.get('/analytics', checkPermission('set_smtp'), analyticsSettingController.getAnalyticsSettings);
router.post('/analytics', checkPermission('set_smtp'), analyticsSettingController.saveAnalyticsSettings);

module.exports = router;
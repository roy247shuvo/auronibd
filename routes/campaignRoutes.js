const express = require('express');
const router = express.Router();
const campaignController = require('../controllers/campaignController');
const checkPermission = require('../middleware/permissionMiddleware');

router.get('/sms', checkPermission('camp_sms'), campaignController.getSmsCampaigns);
router.post('/sms/send', checkPermission('camp_sms'), campaignController.sendSmsCampaign); // [NEW] Send Logic
router.post('/sms/save', checkPermission('camp_sms'), campaignController.saveSmsSettings);
router.get('/sms/balance', checkPermission('camp_sms'), campaignController.getSmsBalance);
router.get('/meta', checkPermission('camp_meta'), campaignController.getMetaCampaigns);

// Subscribers
router.get('/subscribers', checkPermission('camp_subs'), campaignController.getSubscribers);
router.post('/subscribers/delete', checkPermission('camp_subs'), campaignController.deleteSubscriber);

module.exports = router;
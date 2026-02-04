const express = require('express');
const router = express.Router();
const websiteController = require('../controllers/websiteController');
const checkPermission = require('../middleware/permissionMiddleware');

router.get('/elements', checkPermission('web_elements'), websiteController.getElements);
router.post('/elements/save', checkPermission('web_elements'), websiteController.saveLightbox);
router.post('/elements/delete/:id', checkPermission('web_elements'), websiteController.deleteLightbox);

router.get('/checkout-options', checkPermission('web_checkout'), websiteController.getCheckoutSettings);
router.post('/checkout-options', checkPermission('web_checkout'), websiteController.updateCheckoutSettings);

module.exports = router;
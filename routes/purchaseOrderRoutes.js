const express = require('express');
const router = express.Router();
const poController = require('../controllers/purchaseOrderController');
const checkPermission = require('../middleware/permissionMiddleware'); // Added

router.get('/', checkPermission('prod_po'), poController.getPOList);
router.get('/search-product', checkPermission('prod_po'), poController.searchProductForPO);
router.get('/api/search-materials', checkPermission('prod_po'), poController.getMaterialsForPO);
router.get('/variant-snapshot/:id', checkPermission('prod_po'), poController.getProductVariantsSnapshot);
router.post('/create', checkPermission('prod_po'), poController.createPurchaseOrder);
router.post('/receive/:id', checkPermission('prod_po'), poController.receivePurchaseOrder);

router.post('/add-payment', checkPermission('prod_po'), poController.addPayment);

router.get('/details/:id', checkPermission('prod_po'), poController.getPODetails);

module.exports = router;
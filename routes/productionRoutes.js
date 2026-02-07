const express = require('express');
const router = express.Router();
const productionController = require('../controllers/productionController');
const checkPermission = require('../middleware/permissionMiddleware'); 
const authController = require('../controllers/authController');

// Protect all routes
router.use(authController.isLoggedIn);

// Material Management
router.get('/materials', checkPermission('product_manage'), productionController.getMaterials);
router.post('/materials/add', checkPermission('product_manage'), productionController.createMaterial);
router.post('/materials/stock', checkPermission('product_manage'), productionController.addMaterialStock);

router.post('/categories/add', checkPermission('product_manage'), productionController.createCategory);
router.post('/variants/add', checkPermission('product_manage'), productionController.createVariant);

// Production Workflow
router.get('/', checkPermission('product_manage'), productionController.getDashboard);
router.get('/create', checkPermission('product_manage'), productionController.createRunPage);
router.post('/create', checkPermission('product_manage'), productionController.storeRun);
router.post('/finalize/:id', checkPermission('product_manage'), productionController.finalizeRun);

module.exports = router;
const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const productAjaxController = require('../controllers/productAjaxController'); // <--- Import New Controller
const checkPermission = require('../middleware/permissionMiddleware'); // Added

// ... (Existing Routes) ...
router.get('/', checkPermission('prod_inventory'), productController.getInventoryPage);
// Place permission check BEFORE other middleware/controllers
router.post('/save', checkPermission('prod_inventory'), productController.saveProduct);

// === NEW AJAX ROUTES ===
router.get('/edit/:id', checkPermission('prod_inventory'), productAjaxController.getEditProductForm);
router.get('/view/:id', checkPermission('prod_inventory'), productAjaxController.getViewProductModal);
router.get('/variant/edit/:id', checkPermission('prod_inventory'), productAjaxController.getEditVariantForm);
router.get('/delete/:id', checkPermission('prod_inventory'), productController.deleteProduct);

router.post('/update', checkPermission('prod_inventory'), productController.updateProduct);
router.post('/variant/update', checkPermission('prod_inventory'), productAjaxController.updateVariant);
router.get('/variants/json/:id', checkPermission('prod_inventory'), productAjaxController.getProductVariantsJSON);

module.exports = router;
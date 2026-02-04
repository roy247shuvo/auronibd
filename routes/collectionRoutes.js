const express = require('express');
const router = express.Router();
const collectionController = require('../controllers/collectionController');
const checkPermission = require('../middleware/permissionMiddleware'); // Added
const multer = require('multer');

// --- CHANGE THIS BLOCK ---
// OLD (Wrong): const upload = multer({ dest: 'uploads/' });
// NEW (Correct): Import your Cloudinary storage
const { storage } = require('../config/cloudinary');
const upload = multer({ storage: storage });
// -------------------------

// Pages
router.get('/', checkPermission('prod_collections'), collectionController.getCollectionsPage);
router.get('/manage/:id', checkPermission('prod_collections'), collectionController.getManagePage);

// Actions
// Now 'image' will be uploaded to Cloudinary, and req.file.path will be the http URL
// Note: Permission check comes BEFORE upload to save resources if denied
router.post('/save', checkPermission('prod_collections'), upload.single('image'), collectionController.saveCollection);
router.post('/delete/:id', checkPermission('prod_collections'), collectionController.deleteCollection);

// AJAX Actions
router.post('/add-product', checkPermission('prod_collections'), express.json(), collectionController.addProductByBarcode);
router.post('/remove-product', checkPermission('prod_collections'), express.json(), collectionController.removeProduct);

module.exports = router;
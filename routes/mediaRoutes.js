const express = require('express');
const router = express.Router();
const mediaController = require('../controllers/mediaController');
const checkPermission = require('../middleware/permissionMiddleware'); // Added
const multer = require('multer');
const { storage } = require('../config/cloudinary');
const path = require('path');

// 1. Cloudinary Storage (For Products)
const upload = multer({ storage: storage });

// 2. Local Storage (For Logos)
const localStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/uploads/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'logo-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const uploadLocal = multer({ storage: localStorage });

// Endpoints
router.post('/upload', checkPermission('prod_inventory'), upload.single('file'), mediaController.uploadImage);
router.post('/upload-local', checkPermission('set_store'), uploadLocal.single('file'), mediaController.uploadLocalImage); 
router.get('/list', checkPermission('prod_inventory'), mediaController.getLibrary);

module.exports = router;
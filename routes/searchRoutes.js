const express = require('express');
const router = express.Router();
const searchController = require('../controllers/searchController');

// Standard Page Search
router.get('/search', searchController.searchProducts);

// Live JSON Search (API)
router.get('/search/live', searchController.liveSearch);

module.exports = router;
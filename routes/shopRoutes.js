const express = require('express');
const router = express.Router();
const shopController = require('../controllers/shopController');
const checkoutController = require('../controllers/checkoutController'); 
const bkashController = require('../controllers/bkashController');
const customerAccountController = require('../controllers/customerAccountController'); // Add this line

// Public Website Routes
router.get('/', shopController.getHome);
router.get('/shop', shopController.getShop);
router.post('/shop/filter', express.json(), shopController.filterProducts);
router.get('/product/:slug', shopController.getProduct);
router.get('/pages/:page', shopController.getPage);

// --- CART & CHECKOUT ROUTES [ADDED] ---
router.get('/cart/api', checkoutController.getCartAPI); // Fetches JSON for Sidebar
router.post('/cart/add', express.json(), checkoutController.addToCart);
router.post('/cart/update', express.json(), checkoutController.updateCartItem);
router.post('/cart/remove', express.json(), checkoutController.removeCartItem);
router.get('/checkout', checkoutController.getCheckout);
router.post('/checkout/capture-incomplete', express.json(), checkoutController.captureIncomplete);
router.post('/checkout/place-order', express.urlencoded({ extended: true }), checkoutController.placeOrder); // New POST route

// --- ACCOUNT ROUTES ---
router.get('/account', customerAccountController.getAccount);
router.post('/customer/update-profile', express.urlencoded({ extended: true }), customerAccountController.updateProfile);
router.get('/customer/logout', require('../controllers/shopAuthController').logout);

router.get('/order-confirmation/:order_number', checkoutController.orderConfirmation);

// bKash Callback Route
router.get('/bkash/callback', bkashController.bkashCallback);


router.get('/contact', shopController.getContact);
router.get('/shipping-policy', shopController.getShippingPolicy);
router.get('/returns-policy', shopController.getReturnsPolicy);
router.post('/subscribe', shopController.subscribe);

router.post('/api/visitor-heartbeat', express.json(), shopController.heartbeat);

module.exports = router;
const express = require('express');
const router = express.Router();
const accountController = require('../controllers/accountController');
const settlementController = require('../controllers/settlementController');
const authController = require('../controllers/authController');
const salesController = require('../controllers/salesController');
const marketingController = require('../controllers/marketingController');
const checkPermission = require('../middleware/permissionMiddleware'); // CORRECT IMPORT

router.get('/overview', authController.isLoggedIn, checkPermission('acc_overview'), accountController.getOverview);

// Settings Page (List Accounts)
router.get('/settings', authController.isLoggedIn, checkPermission('acc_settings'), accountController.getSettings);

// Courier Data & Sync (Overview)
router.get('/courier-data', authController.isLoggedIn, checkPermission('acc_overview'), accountController.getCourierData);
router.post('/sync-steadfast', authController.isLoggedIn, checkPermission('acc_overview'), settlementController.syncSettlements);

// --- EXPENSE ROUTES ---
router.get('/expenses', authController.isLoggedIn, checkPermission('acc_expenses'), accountController.getExpenses);
router.post('/expenses/add', authController.isLoggedIn, checkPermission('acc_expenses'), accountController.addExpense);
router.post('/expenses/delete/:id', authController.isLoggedIn, checkPermission('acc_expenses'), accountController.deleteExpense);

router.post('/gateway-fees/update', authController.isLoggedIn, checkPermission('acc_settings'), accountController.updateGatewayFees);

router.get('/pl-report', authController.isLoggedIn, checkPermission('acc_reports'), accountController.getPLReport);

// --- BALANCE SHEET ROUTES ---
router.get('/balance-sheet', authController.isLoggedIn, checkPermission('acc_reports'), accountController.getBalanceSheet);
router.post('/capital/add', authController.isLoggedIn, checkPermission('acc_settings'), accountController.addCapital);
router.post('/capital/withdraw', authController.isLoggedIn, checkPermission('acc_settings'), accountController.withdrawCapital);

// Manage Accounts
router.post('/settings/add', authController.isLoggedIn, checkPermission('acc_settings'), accountController.addAccount);
router.post('/settings/edit', authController.isLoggedIn, checkPermission('acc_settings'), accountController.editAccount);
router.post('/settings/delete/:id', authController.isLoggedIn, checkPermission('acc_settings'), accountController.deleteAccount);

// Transfers
router.get('/transfers', authController.isLoggedIn, checkPermission('acc_transfers'), accountController.getTransfers);
router.post('/transfers/add', authController.isLoggedIn, checkPermission('acc_transfers'), accountController.addTransfer);

// --- NEW ROUTES (SALES & MARKETING) ---
router.get('/sales', authController.isLoggedIn, checkPermission('acc_sales'), salesController.getSalesPage);
router.get('/marketing', authController.isLoggedIn, checkPermission('acc_reports'), marketingController.getMarketingPage);

module.exports = router;
const express = require('express');
const router = express.Router();
const multer = require('multer'); // [NEW] Import Multer
const upload = multer({ storage: multer.memoryStorage() }); // [NEW] Configure Memory Storage

const accountController = require('../controllers/accountController');
const settlementController = require('../controllers/settlementController');
const authController = require('../controllers/authController');
const salesController = require('../controllers/salesController');
const marketingController = require('../controllers/marketingController');
const checkPermission = require('../middleware/permissionMiddleware'); 

router.get('/overview', authController.isLoggedIn, checkPermission('acc_overview'), accountController.getOverview);

// Settings Page (List Accounts)
router.get('/settings', authController.isLoggedIn, checkPermission('acc_settings'), accountController.getSettings);

router.get('/fix-cogs', authController.isLoggedIn, checkPermission('acc_settings'), accountController.fixHistoricalCOGS);

router.get('/fix-expenses', authController.isLoggedIn, checkPermission('acc_settings'), accountController.fixHistoricalExpenses);

// Courier Data Page
router.get('/courier-data', authController.isLoggedIn, checkPermission('acc_overview'), accountController.getCourierData);

// [NEW] Settlement Routes (Batch System)
router.get('/settlements/pending', authController.isLoggedIn, checkPermission('acc_overview'), settlementController.getPendingBatches);

// [FIX] Removed 'getBatchDetails' as it is no longer used in the new workflow
// router.get('/settlements/batch/:id', ...); 

// [NEW] Verify Batch Route (Requires Multer for File Upload)
router.post('/settlements/verify', authController.isLoggedIn, checkPermission('acc_overview'), upload.single('file'), settlementController.verifyBatch);

// [UPDATED] Process Batch Route (Standard JSON)
router.post('/settlements/process', authController.isLoggedIn, checkPermission('acc_overview'), settlementController.processBatch);

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

// [UPDATED] Marketing Tab Routes
router.get('/marketing', authController.isLoggedIn, checkPermission('acc_reports'), (req, res) => res.redirect('/admin/accounts/marketing/vault'));
router.get('/marketing/sns', authController.isLoggedIn, checkPermission('acc_reports'), marketingController.getSnsPage);
router.get('/marketing/vault', authController.isLoggedIn, checkPermission('acc_reports'), marketingController.getVaultPage);
router.get('/marketing/other', authController.isLoggedIn, checkPermission('acc_reports'), marketingController.getOtherPage);

// [NEW] SNS Marketing CSV Parsing & Import
router.post('/marketing/sns/parse', authController.isLoggedIn, checkPermission('acc_reports'), upload.single('csv_file'), marketingController.parseSnsCsv);
router.post('/marketing/sns/import', authController.isLoggedIn, checkPermission('acc_reports'), marketingController.importSnsExpenses);

// [NEW] Marketing Vault Search & Actions
router.get('/marketing/search', authController.isLoggedIn, checkPermission('acc_reports'), marketingController.searchVaultProduct);
router.post('/marketing/transfer', authController.isLoggedIn, checkPermission('acc_reports'), marketingController.transferToVault);
router.post('/marketing/return', authController.isLoggedIn, checkPermission('acc_reports'), marketingController.returnFromVault);

module.exports = router;
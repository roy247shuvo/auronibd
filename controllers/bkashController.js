const db = require('../config/database');
const bkashService = require('../config/bkashService');

// Helper to Restore Stock
async function restoreStock(order_number) {
    const [order] = await db.query("SELECT id FROM orders WHERE order_number = ?", [order_number]);
    if (order.length === 0) return;
    
    const [items] = await db.query("SELECT variant_id, quantity FROM order_items WHERE order_id = ?", [order[0].id]);

    for (const item of items) {
        if (item.variant_id) {
            await db.query("UPDATE product_variants SET stock_quantity = stock_quantity + ? WHERE id = ?", [item.quantity, item.variant_id]);
        }
    }
}

exports.bkashCallback = async (req, res) => {
    const { paymentID, status, order_number } = req.query;

    // --- 1. HANDLE IMMEDIATE CANCEL/FAILURE ---
    if (status === 'cancel' || status === 'failure') {
        console.log(`Payment ${status} for ${order_number}. Restoring stock...`);
        
        // Use 'payment_cancelled' status
        await db.query("UPDATE orders SET status = 'payment_cancelled' WHERE order_number = ?", [order_number]);
        
        await restoreStock(order_number);

        return res.redirect(`/shop?error=Payment ${status}`);
    }

    try {
        // --- 2. EXECUTE PAYMENT ---
        const token = await bkashService.grantToken();
        const execution = await bkashService.executePayment(token, paymentID);

        // Check bKash Status
        if (execution.statusCode && execution.statusCode !== '0000') {
            console.error("Execution Failed:", execution.statusMessage);
            await db.query("UPDATE orders SET status = 'failed' WHERE order_number = ?", [order_number]);
            await restoreStock(order_number); 
            return res.redirect(`/shop?error=${execution.statusMessage}`);
        }

        // --- 3. SECURITY CHECKS ---

        // A. Invoice Mismatch
        if (execution.merchantInvoiceNumber !== order_number) {
            console.error("FRAUD ALERT: Invoice Mismatch", { expected: order_number, got: execution.merchantInvoiceNumber });
            await db.query("UPDATE orders SET status = 'fraud_check' WHERE order_number = ?", [order_number]);
            return res.redirect(`/shop?error=Security Violation: Invoice Mismatch`);
        }

        // B. Amount Mismatch
        const [orderData] = await db.query("SELECT total_amount, delivery_charge, payment_method FROM orders WHERE order_number = ?", [order_number]);
        
        if (orderData.length === 0) return res.redirect('/shop?error=Order not found');
        const order = orderData[0];

        let expectedAmount = parseFloat(order.total_amount);
        if (order.payment_method === 'cod') {
            expectedAmount = parseFloat(order.delivery_charge);
        }

        // --- VAR DECLARED HERE (DO NOT REDECLARE BELOW) ---
        const paidAmount = parseFloat(execution.amount);

        // Allow tiny floating point difference
        if (Math.abs(expectedAmount - paidAmount) > 1.00) {
            console.error("FRAUD ALERT: Amount Mismatch", { expected: expectedAmount, paid: paidAmount });
            await db.query("UPDATE orders SET status = 'fraud_check' WHERE order_number = ?", [order_number]);
            return res.redirect(`/shop?error=Security Violation: Amount mismatch.`);
        }

        // --- 4. SUCCESS: UPDATE ORDER ---
        let newPaymentStatus = (order.payment_method === 'cod') ? 'partial_paid' : 'paid';
        const trxID = execution.trxID || null; 

        // --- NEW: GET DEFAULT DEPOSIT ACCOUNT ---
        const [settings] = await db.query("SELECT bkash_deposit_account_id FROM shop_settings LIMIT 1");
        const depositAccountId = settings[0].bkash_deposit_account_id;

        // --- NEW: CALCULATE & CAPTURE FEE ---
        let capturedFee = 0;
        if (depositAccountId) {
            const [account] = await db.query("SELECT gateway_fee FROM bank_accounts WHERE id = ?", [depositAccountId]);
            if (account.length > 0 && account[0].gateway_fee > 0) {
                capturedFee = paidAmount * (parseFloat(account[0].gateway_fee) / 100);
            }
        }

        // UPDATE ORDER
        await db.query(`
            UPDATE orders 
            SET status = 'confirmed', 
                payment_trx_id = ?, 
                payment_status = ?,
                paid_amount = ?,
                bank_account_id = ?,
                gateway_fee = gateway_fee + ?  -- Add to existing (in case of partials)
            WHERE order_number = ?
        `, [trxID, newPaymentStatus, paidAmount, depositAccountId, capturedFee, order_number]);

        // --- NEW: DEPOSIT MONEY ---
        if (depositAccountId) {
            await db.query("UPDATE bank_accounts SET current_balance = current_balance + ? WHERE id = ?", [paidAmount, depositAccountId]);
        }

        // Clear Cart & Finish
        req.session.cart = [];
        
        // Grant Permission
        req.session.allowed_order = order_number;
        req.session.save(); 

        res.redirect(`/order-confirmation/${order_number}`);

    } catch (error) {
        console.error("bKash Callback System Error:", error);
        res.redirect(`/shop?error=Payment processing error. Please contact support.`);
    }
};
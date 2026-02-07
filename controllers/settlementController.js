const db = require('../config/database');
const steadfast = require('../config/steadfast');

// 1. Fetch Pending Batches (List View)
exports.getPendingBatches = async (req, res) => {
    try {
        console.log("--- FETCHING PENDING BATCHES ---");

        // A. Call API
        const response = await steadfast.getPayments();
        console.log("Steadfast Response:", JSON.stringify(response, null, 2));

        // B. Extract Array (Handle generic wrappers)
        let apiBatches = [];
        if (Array.isArray(response)) apiBatches = response;
        else if (response && typeof response === 'object') {
            if (Array.isArray(response.data)) apiBatches = response.data;
            else if (Array.isArray(response.payments)) apiBatches = response.payments;
            else if (Array.isArray(response.consignments)) apiBatches = response.consignments;
        }

        // C. Get Processed IDs
        const [processed] = await db.query("SELECT batch_id FROM settlement_batches");
        const processedIds = new Set(processed.map(p => String(p.batch_id)));

        // D. Normalize Data
        const pendingBatches = apiBatches
            .map(b => {
                const id = b.id || b.payment_id || b.batch_id || b.invoice || 'Unknown';
                const amount = parseFloat(b.cod_amount || b.amount || b.total_amount || b.total_collection || b.net_amount || 0);
                
                // If API doesn't give count, we mark it as '?'
                // The details view will calculate the real count later
                let count = b.total_consignment || b.total_parcel || b.consignment_count || b.count || '?';
                if (count === '?' && Array.isArray(b.consignments)) count = b.consignments.length;

                return {
                    id: String(id),
                    cod_amount: amount,
                    total_consignment: count, 
                    created_at: b.created_at || b.date || b.payment_date || new Date().toISOString(),
                    status: b.status || 'pending'
                };
            })
            .filter(b => b.id !== 'Unknown' && !processedIds.has(b.id));

        res.json({ success: true, batches: pendingBatches });

    } catch (err) {
        console.error("Settlement Error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};

// 2. Get Batch Details (Modal View) - CALCULATES TOTALS MANUALLY
exports.getBatchDetails = async (req, res) => {
    try {
        const batchId = req.params.id;
        console.log(`--- FETCHING DETAILS FOR BATCH: ${batchId} ---`);
        
        const response = await steadfast.getPaymentDetails(batchId);
        
        // A. Extract Items List
        let rawItems = [];
        if (Array.isArray(response)) rawItems = response;
        else if (response && typeof response === 'object') {
            // Check every possible key where the list might be hidden
            if (Array.isArray(response.consignments)) rawItems = response.consignments;
            else if (Array.isArray(response.data)) rawItems = response.data;
            else if (Array.isArray(response.items)) rawItems = response.items;
            else if (Array.isArray(response.orders)) rawItems = response.orders;
        }

        // B. Normalize Items & Map CSV Keys
        const items = rawItems.map(item => {
            // CSV: Invoice, Order ID, Tracking Code
            const invoice = item.invoice || item.invoice_id || item.consignment_id || item.tracking_code || 'N/A';
            
            // CSV: "COD Amount"
            const cod = parseFloat(item.cod_amount || item.amount || item.collection_amount || 0);
            
            // CSV: "Shipping Charge" (THIS IS THE KEY FIX)
            const delivery = parseFloat(item.shipping_charge || item.delivery_charge || item.charge || item.cost || 0);
            
            // Fee (If any)
            const fee = parseFloat(item.cod_charge || item.cod_fee || 0);

            return {
                invoice: invoice,
                cod_amount: cod,
                delivery_charge: delivery,
                cod_charge: fee,
                status: item.status || 'delivered'
            };
        });

        // C. Calculate Summary (Since API doesn't provide it)
        const summary = {
            total_orders: items.length,
            total_cod: items.reduce((sum, i) => sum + i.cod_amount, 0),
            total_delivery: items.reduce((sum, i) => sum + i.delivery_charge, 0),
            total_fee: items.reduce((sum, i) => sum + i.cod_charge, 0)
        };
        // Net Payout = COD - Delivery - Fee
        summary.net_payout = summary.total_cod - summary.total_delivery - summary.total_fee;

        console.log(`Calculated Summary:`, summary);

        res.json({ success: true, items: items, summary: summary });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
};

// 3. Process Batch (Save to DB)
exports.processBatch = async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const { batch_id, target_account_id } = req.body;
        console.log(`Processing Batch: ${batch_id}`);

        // A. Check Duplication
        const [exists] = await conn.query("SELECT id FROM settlement_batches WHERE batch_id = ?", [batch_id]);
        if (exists.length > 0) throw new Error("This batch has already been processed!");

        // B. Fetch Data
        const response = await steadfast.getPaymentDetails(batch_id);
        
        let rawItems = [];
        if (Array.isArray(response)) rawItems = response;
        else if (response && typeof response === 'object') {
            if (Array.isArray(response.consignments)) rawItems = response.consignments;
            else if (Array.isArray(response.data)) rawItems = response.data;
        }

        let totalNetDeposit = 0;
        let processedCount = 0;

        // C. Loop & Update
        for (const item of rawItems) {
            // [FIX] Updated Keys based on CSV
            const invoice = item.invoice || item.invoice_id || item.consignment_id;
            const grossCOD = parseFloat(item.cod_amount || item.amount || 0);
            
            // [FIX] Added shipping_charge here as well
            const deliveryCharge = parseFloat(item.shipping_charge || item.delivery_charge || item.charge || 0);
            
            const codFee = item.cod_charge ? parseFloat(item.cod_charge) : (grossCOD * 0.01); // 1% fallback

            if (!invoice) continue;

            // Find Local Order (Using text matching for safety)
            const [orders] = await conn.query("SELECT id, settled_at FROM orders WHERE order_number = ? FOR UPDATE", [invoice]);
            
            if (orders.length > 0) {
                const order = orders[0];
                if (order.settled_at) {
                    console.log(`Skipping Order ${invoice}: Already Settled`);
                    continue;
                }

                const netPayout = grossCOD - deliveryCharge - codFee;
                totalNetDeposit += netPayout;

                // Update Order Status
                await conn.query(`
                    UPDATE orders 
                    SET status = 'delivered', 
                        payment_status = 'paid',
                        courier_delivery_charge = ?,
                        cod_received = ?, 
                        gateway_fee = gateway_fee + ?,
                        settled_at = NOW(),
                        bank_account_id = ?
                    WHERE id = ?
                `, [deliveryCharge, grossCOD, codFee, target_account_id, order.id]);

                processedCount++;
            }
        }

        // D. Update Bank Balance
        if (totalNetDeposit > 0) {
            await conn.query(`UPDATE bank_accounts SET current_balance = current_balance + ? WHERE id = ?`, [totalNetDeposit, target_account_id]);
        }

        // E. Close Batch
        await conn.query(`INSERT INTO settlement_batches (batch_id, amount, deposit_account_id) VALUES (?, ?, ?)`, [batch_id, totalNetDeposit, target_account_id]);

        await conn.commit();
        res.json({ success: true, message: `Successfully processed ${processedCount} orders. Deposited: ${totalNetDeposit}` });

    } catch (err) {
        await conn.rollback();
        console.error(err);
        res.status(500).json({ success: false, message: "Error: " + err.message });
    } finally {
        conn.release();
    }
};
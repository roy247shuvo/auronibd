const db = require('../config/database');
const steadfast = require('../config/steadfast');

// --- HELPER: Smartly find the array of orders in any JSON structure ---
function findDataArray(obj) {
    if (!obj) return [];
    if (Array.isArray(obj)) return obj;
    
    // 1. Common Top-Level Keys
    const keys = ['consignments', 'data', 'items', 'orders', 'payments', 'list'];
    for (const key of keys) {
        if (Array.isArray(obj[key])) return obj[key];
    }

    // 2. Nested Keys (e.g. response.payment.consignments)
    for (const key in obj) {
        if (obj[key] && typeof obj[key] === 'object') {
            for (const subKey of keys) {
                if (Array.isArray(obj[key][subKey])) return obj[key][subKey];
            }
        }
    }
    
    return [];
}

// 1. Fetch Pending Batches
exports.getPendingBatches = async (req, res) => {
    try {
        console.log("--- CHECKING FOR NEW PAYMENTS ---");
        const response = await steadfast.getPayments();
        console.log("API Response (Summary):", JSON.stringify(response, null, 2));

        const apiBatches = findDataArray(response);

        // Get processed IDs
        const [processed] = await db.query("SELECT batch_id FROM settlement_batches");
        const processedIds = new Set(processed.map(p => String(p.batch_id)));

        const pendingBatches = apiBatches
            .map(b => {
                const id = b.id || b.payment_id || b.batch_id || b.invoice || 'Unknown';
                const amount = parseFloat(b.cod_amount || b.amount || b.total_amount || b.total_collection || b.net_amount || 0);
                
                // Try to find count or calculate from array length if available
                let count = b.total_consignment || b.total_parcel || b.consignment_count || b.count || '?';
                if (count === '?' && b.consignments && Array.isArray(b.consignments)) count = b.consignments.length;

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
        console.error("Settlement List Error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};

// 2. Get Batch Details (The View Modal)
exports.getBatchDetails = async (req, res) => {
    try {
        const batchId = req.params.id;
        console.log(`--- DETAILS FOR BATCH ${batchId} ---`);
        
        const response = await steadfast.getPaymentDetails(batchId);
        // console.log("Full Details Response:", JSON.stringify(response, null, 2)); // Uncomment to debug

        // USE DEEP SEARCH TO FIND THE ORDERS
        const rawItems = findDataArray(response);
        console.log(`Found ${rawItems.length} items in batch.`);

        const items = rawItems.map(item => {
            return {
                // Key Identifiers
                invoice: item.invoice || item.invoice_id || item.consignment_id || item.tracking_code || 'N/A',
                tracking_code: item.tracking_code || '',
                
                // Financials (Based on CSV & Standard API)
                cod_amount: parseFloat(item.cod_amount || item.amount || item.collection_amount || 0),
                // "Shipping Charge" from CSV usually maps to 'shipping_charge' or 'delivery_charge'
                delivery_charge: parseFloat(item.shipping_charge || item.delivery_charge || item.charge || item.cost || 0),
                cod_charge: parseFloat(item.cod_charge || item.cod_fee || 0),
                
                status: item.status || 'delivered'
            };
        });

        // Manual Totals Calculation
        const summary = {
            total_orders: items.length,
            total_cod: items.reduce((sum, i) => sum + i.cod_amount, 0),
            total_delivery: items.reduce((sum, i) => sum + i.delivery_charge, 0),
            total_fee: items.reduce((sum, i) => sum + i.cod_charge, 0)
        };
        summary.net_payout = summary.total_cod - summary.total_delivery - summary.total_fee;

        res.json({ success: true, items: items, summary: summary });

    } catch (err) {
        console.error("Batch Details Error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};

// 3. Process Batch (The Settlement Action)
exports.processBatch = async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const { batch_id, target_account_id } = req.body;
        console.log(`Processing Batch ${batch_id}...`);

        // Check duplicate
        const [exists] = await conn.query("SELECT id FROM settlement_batches WHERE batch_id = ?", [batch_id]);
        if (exists.length > 0) throw new Error("Batch already processed.");

        // Fetch Data
        const response = await steadfast.getPaymentDetails(batch_id);
        const rawItems = findDataArray(response);

        let totalNetDeposit = 0;
        let processedCount = 0;

        for (const item of rawItems) {
            const invoice = item.invoice || item.invoice_id || item.consignment_id;
            const trackingCode = item.tracking_code;

            if (!invoice && !trackingCode) continue;

            const grossCOD = parseFloat(item.cod_amount || item.amount || 0);
            const deliveryCharge = parseFloat(item.shipping_charge || item.delivery_charge || item.charge || 0);
            const codFee = parseFloat(item.cod_charge || item.cod_fee || 0);

            // Try to find order by Invoice OR Tracking Code
            // We use 'OR' to be safe
            const [orders] = await conn.query(`
                SELECT id, settled_at 
                FROM orders 
                WHERE order_number = ? OR (tracking_code = ? AND tracking_code IS NOT NULL)
                FOR UPDATE
            `, [invoice, trackingCode || 'INVALID_CODE']);
            
            if (orders.length > 0) {
                const order = orders[0];
                if (order.settled_at) {
                    console.log(`Skipping Order ${order.id}: Already settled.`);
                    continue;
                }

                const netPayout = grossCOD - deliveryCharge - codFee;
                totalNetDeposit += netPayout;

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

        if (totalNetDeposit > 0) {
            await conn.query(`UPDATE bank_accounts SET current_balance = current_balance + ? WHERE id = ?`, [totalNetDeposit, target_account_id]);
        }

        await conn.query(`INSERT INTO settlement_batches (batch_id, amount, deposit_account_id) VALUES (?, ?, ?)`, [batch_id, totalNetDeposit, target_account_id]);

        await conn.commit();
        res.json({ success: true, message: `Processed ${processedCount} orders. Deposit: ${totalNetDeposit}` });

    } catch (err) {
        await conn.rollback();
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        conn.release();
    }
};
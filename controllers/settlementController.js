const db = require('../config/database');
const steadfast = require('../config/steadfast');

// 1. Fetch Pending Batches (For the Cards)
exports.getPendingBatches = async (req, res) => {
    try {
        console.log("--- STARTING SETTLEMENT CHECK ---");

        // A. Get all batches from Steadfast API
        const response = await steadfast.getPayments();
        
        console.log("Steadfast Raw Response:", JSON.stringify(response, null, 2)); // DEBUG LOG

        let apiBatches = [];

        // SMARTER EXTRACTION LOGIC
        if (Array.isArray(response)) {
            // Case 1: It's a direct array [ {id:1}, {id:2} ]
            apiBatches = response;
        } else if (response && typeof response === 'object') {
            // Case 2: It's inside a key like { data: [...] } or { payments: [...] }
            if (Array.isArray(response.data)) {
                apiBatches = response.data;
            } else if (Array.isArray(response.payments)) {
                apiBatches = response.payments;
            } else if (Array.isArray(response.consignments)) {
                apiBatches = response.consignments;
            } else {
                // Last resort: Look for ANY key that is an array
                const keys = Object.keys(response);
                for (const key of keys) {
                    if (Array.isArray(response[key])) {
                        apiBatches = response[key];
                        console.log(`Found batches inside key: '${key}'`);
                        break;
                    }
                }
            }
        }

        console.log(`Found ${apiBatches.length} total batches from API.`);

        // B. Get already processed batches from our DB
        const [processed] = await db.query("SELECT batch_id FROM settlement_batches");
        const processedIds = new Set(processed.map(p => String(p.batch_id)));

        // C. Filter: Only show batches we haven't touched yet
        const pendingBatches = apiBatches.filter(b => {
            // Ensure we use the correct ID field (sometimes it's 'id', sometimes 'payment_id')
            const batchId = String(b.id || b.payment_id || b.consignment_id);
            return !processedIds.has(batchId);
        });

        console.log(`Showing ${pendingBatches.length} pending batches to user.`);

        res.json({ success: true, batches: pendingBatches });
    } catch (err) {
        console.error("Settlement Error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};

// 2. Get Details for a Specific Batch (For the Modal)
exports.getBatchDetails = async (req, res) => {
    try {
        const batchId = req.params.id;
        const details = await steadfast.getPaymentDetails(batchId);
        
        console.log(`Batch ${batchId} Details:`, JSON.stringify(details, null, 2)); // DEBUG LOG

        let items = [];
        if (details && Array.isArray(details.consignments)) items = details.consignments;
        else if (details && Array.isArray(details.data)) items = details.data;
        else if (details && Array.isArray(details.items)) items = details.items; // Added generic check
        else if (Array.isArray(details)) items = details;

        res.json({ success: true, items: items });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
};

// 3. Process & Receive Money (The Action)
exports.processBatch = async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const { batch_id, target_account_id } = req.body;
        
        // A. Double check duplication
        const [exists] = await conn.query("SELECT id FROM settlement_batches WHERE batch_id = ?", [batch_id]);
        if (exists.length > 0) throw new Error("This batch has already been processed!");

        // B. Fetch details again to be safe
        const details = await steadfast.getPaymentDetails(batch_id);
        let items = [];
        if (details && Array.isArray(details.consignments)) items = details.consignments;
        else if (details && Array.isArray(details.data)) items = details.data;
        else if (Array.isArray(details)) items = details;

        let totalNetDeposit = 0;
        let processedCount = 0;

        // C. Loop through items
        for (const item of items) {
            // Ensure we match the invoice correctly. Sometimes API sends 'invoice' or 'invoice_id'
            const invoice = item.invoice || item.invoice_id; 
            
            // Find order (Lock row)
            const [orders] = await conn.query("SELECT id, settled_at FROM orders WHERE order_number = ? FOR UPDATE", [invoice]);
            
            if (orders.length > 0) {
                const order = orders[0];
                if (order.settled_at) continue; // Skip if already settled individually

                // Calcs
                const grossCOD = parseFloat(item.cod_amount) || 0;
                const deliveryCharge = parseFloat(item.delivery_charge) || 0;
                // Assuming item.cod_charge exists, otherwise calculate 1%
                const codFee = item.cod_charge ? parseFloat(item.cod_charge) : (grossCOD * 0.01); 
                
                const netPayout = grossCOD - deliveryCharge - codFee;

                totalNetDeposit += netPayout;

                // Update Order
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

        // D. Deposit to Bank
        if (totalNetDeposit > 0) {
            await conn.query(`UPDATE bank_accounts SET current_balance = current_balance + ? WHERE id = ?`, [totalNetDeposit, target_account_id]);
        }

        // E. Record Batch as "Settled"
        await conn.query(`INSERT INTO settlement_batches (batch_id, amount, deposit_account_id) VALUES (?, ?, ?)`, [batch_id, totalNetDeposit, target_account_id]);

        await conn.commit();
        res.json({ success: true, message: `Received ৳${totalNetDeposit.toLocaleString()} for ${processedCount} orders.` });

    } catch (err) {
        await conn.rollback();
        console.error(err);
        res.status(500).json({ success: false, message: "Error: " + err.message });
    } finally {
        conn.release();
    }
};
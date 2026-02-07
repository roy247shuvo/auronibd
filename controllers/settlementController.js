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
        // console.log("Full Details Response:", JSON.stringify(response, null, 2)); 

        // USE DEEP SEARCH TO FIND THE ORDERS
        const rawItems = findDataArray(response);
        console.log(`Found ${rawItems.length} items in batch.`);

        // [NEW] 1. FETCH LOCAL DELIVERY CHARGES (Since API doesn't provide them)
        const invoiceNumbers = rawItems.map(i => i.invoice).filter(inv => inv);
        let localCharges = {};

        if (invoiceNumbers.length > 0) {
            // Create placeholders for SQL: ?,?,?
            const placeholders = invoiceNumbers.map(() => '?').join(',');
            const [rows] = await db.query(
                `SELECT order_number, courier_delivery_charge FROM orders WHERE order_number IN (${placeholders})`, 
                invoiceNumbers
            );
            // Create a lookup map: { 'INV-101': 120, 'INV-102': 60 }
            rows.forEach(r => { localCharges[r.order_number] = r.courier_delivery_charge; });
        }

        // B. Normalize Items & Calculate 1% Fee on (Collected - Delivery)
        const items = rawItems.map(item => {
            const invoice = item.invoice || item.invoice_id || item.consignment_id || item.tracking_code || 'N/A';
            
            const cod = parseFloat(item.cod_amount || item.amount || item.collection_amount || 0);
            
            // [FIX] Try API first, if 0, use LOCAL DATABASE value
            let delivery = parseFloat(item.delivery_fee || item.bill || item.payable_delivery_charge || item.shipping_charge || item.delivery_charge || 0);
            
            if (delivery === 0 && localCharges[invoice]) {
                delivery = parseFloat(localCharges[invoice]);
            }
            
            // [NEW LOGIC] Fee is 1% of (Collected - Delivery Charge)
            // Example: (1000 - 100) * 1% = 9 TK
            let baseForFee = cod - delivery;
            if (baseForFee < 0) baseForFee = 0;
            const fee = baseForFee * 0.01;

            return {
                invoice: invoice,
                cod_amount: cod,
                delivery_charge: delivery,
                cod_charge: fee, 
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

// 3. Process Batch (The File Upload & Confirmation)
exports.processBatch = async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        // 1. Validate Inputs
        const { batch_id, target_account_id } = req.body;
        const file = req.file;

        if (!file) throw new Error("Please upload the payment file.");
        
        // 2. Validate Filename (Security Check)
        // Expected: "2026-02-07-payment-SFC-28108027.xlsx"
        if (!file.originalname.includes(batch_id)) {
            throw new Error(`File name mismatch! It must contain the Batch ID: ${batch_id}`);
        }

        // 3. Check Duplicate Processing
        const [exists] = await conn.query("SELECT id FROM settlement_batches WHERE batch_id = ?", [batch_id]);
        if (exists.length > 0) throw new Error("This batch has already been processed.");

        // 4. Fetch API Data (The "truth" for Batch Totals)
        const response = await steadfast.getPaymentDetails(batch_id);
        const apiItems = findDataArray(response);
        
        if (apiItems.length === 0) throw new Error("API returned no orders for this batch.");

        // 5. Parse Uploaded File (The "truth" for Delivery Charges)
        const fileRows = parseCSV(file.buffer);
        console.log(`Parsed ${fileRows.length} rows from file.`);

        // Create a Lookup Map from the File:  Invoice -> { Shipping, COD }
        const fileMap = {};
        fileRows.forEach(row => {
            // CSV Header mapping: 'Invoice', 'Shipping Charge', 'COD Amount'
            // We use standard keys assuming the CSV headers match your snippet
            if (row['Invoice']) {
                fileMap[row['Invoice']] = {
                    shipping: parseFloat(row['Shipping Charge'] || 0),
                    cod: parseFloat(row['COD Amount'] || 0)
                };
            }
        });

        // 6. Process Orders
        let processedCount = 0;
        let totalCalculatedFee = 0; // Just for tracking

        for (const apiItem of apiItems) {
            const invoice = apiItem.invoice; 
            if (!invoice) continue;

            // A. MATCHING LOGIC
            const fileData = fileMap[invoice];
            if (!fileData) {
                throw new Error(`Order ${invoice} found in API but MISSING in uploaded file.`);
            }

            // B. VERIFY COD (Security Check)
            const apiCOD = parseFloat(apiItem.cod_amount || 0);
            if (Math.abs(apiCOD - fileData.cod) > 1) { // Allow 1 TK variance
                throw new Error(`COD Mismatch for ${invoice}! API: ${apiCOD}, File: ${fileData.cod}`);
            }

            // C. CALCULATE VALUES
            const deliveryCharge = fileData.shipping; // Sourced from Excel
            const grossCOD = apiCOD;

            // Calculate 1% Fee (Individual Order Record)
            let baseForFee = grossCOD - deliveryCharge;
            if (baseForFee < 0) baseForFee = 0;
            const codFee = baseForFee * 0.01;
            totalCalculatedFee += codFee;

            // D. UPDATE DATABASE
            // We update the order with the Excel Delivery Charge and calculated Fee
            await conn.query(`
                UPDATE orders 
                SET status = 'delivered', 
                    payment_status = 'paid',
                    courier_delivery_charge = ?,
                    cod_received = ?, 
                    gateway_fee = gateway_fee + ?,
                    settled_at = NOW(),
                    bank_account_id = ?
                WHERE order_number = ?
            `, [deliveryCharge, grossCOD, codFee, target_account_id, invoice]);

            processedCount++;
        }

        // 7. FINAL DEPOSIT (The "Bank Truth")
        // We calculate the Net Deposit using the API Summary, NOT the sum of individual rows
        // Summing API items to get the true batch total
        const batchTotalCOD = apiItems.reduce((sum, i) => sum + parseFloat(i.cod_amount || 0), 0);
        
        // We assume the API returns the final payout amount in the summary.
        // If 'response.total' exists (from your snippet it was 12841), use it.
        // Otherwise calculate: Total COD - Total Shipping (from file sum) - Total Fee (from API sum or file calc)
        
        // Let's rely on the API 'summary' object if available, or calculate "Safe Net"
        // Based on your snippet: "total": 12841 is available in the payment summary object
        let finalDepositAmount = 0;
        if (response.total) {
            finalDepositAmount = parseFloat(response.total);
        } else if (response.data && response.data.total) {
            finalDepositAmount = parseFloat(response.data.total);
        } else {
            // Fallback: This shouldn't happen based on your logs
            throw new Error("Could not determine Final Net Amount from API.");
        }

        // Deposit into Bank
        if (finalDepositAmount > 0) {
            await conn.query(`UPDATE bank_accounts SET current_balance = current_balance + ? WHERE id = ?`, [finalDepositAmount, target_account_id]);
        }

        // Record the Batch
        await conn.query(`INSERT INTO settlement_batches (batch_id, amount, deposit_account_id) VALUES (?, ?, ?)`, [batch_id, finalDepositAmount, target_account_id]);

        await conn.commit();
        res.json({ success: true, message: `Successfully verified & processed ${processedCount} orders. Deposited: ${finalDepositAmount}` });

    } catch (err) {
        await conn.rollback();
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        conn.release();
    }
};

// --- HELPER: Native CSV Parser (No library needed) ---
function parseCSV(buffer) {
    const text = buffer.toString();
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    
    return lines.slice(1).map(line => {
        const row = {};
        let current = '';
        let inQuotes = false;
        let colIndex = 0;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') { inQuotes = !inQuotes; }
            else if (char === ',' && !inQuotes) {
                row[headers[colIndex]] = current.trim().replace(/"/g, ''); // Clean quotes
                current = '';
                colIndex++;
            } else { current += char; }
        }
        row[headers[colIndex]] = current.trim().replace(/"/g, ''); // Last column
        return row;
    });
}
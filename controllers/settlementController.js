const db = require('../config/database');
const steadfast = require('../config/steadfast');
const xlsx = require('xlsx');

// --- HELPER: Native CSV Parser (Robust) ---
function parseCSV(buffer) {
    const text = buffer.toString().trim();
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
    
    if (lines.length === 0) return [];

    // [FIX] Parse headers properly (Handle BOM + Detect Delimiter)
    const headerLine = lines[0].replace(/^\uFEFF/, ''); 
    
    // Auto-detect separator: check if line has more semicolons than commas
    const separator = (headerLine.match(/;/g) || []).length > (headerLine.match(/,/g) || []).length ? ';' : ',';
    
    const headers = headerLine.split(separator).map(h => h.trim().replace(/^"|"$/g, '')); // Remove surrounding quotes

    return lines.slice(1).map(line => {
        const row = {};
        let current = '';
        let inQuotes = false;
        let colIndex = 0;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') { inQuotes = !inQuotes; }
            else if (char === separator && !inQuotes) { // Use detected separator
                if (colIndex < headers.length) {
                    row[headers[colIndex]] = current.trim().replace(/^"|"$/g, ''); 
                }
                current = '';
                colIndex++;
            } else { current += char; }
        }
        if (colIndex < headers.length) {
            row[headers[colIndex]] = current.trim().replace(/^"|"$/g, '');
        }
        return row;
    });
}

// --- HELPER: Smartly find the array of orders in any JSON structure ---
function findDataArray(obj) {
    if (!obj) return [];
    if (Array.isArray(obj)) return obj;
    
    const keys = ['consignments', 'data', 'items', 'orders', 'payments', 'list'];
    for (const key of keys) {
        if (Array.isArray(obj[key])) return obj[key];
    }

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
        const apiBatches = findDataArray(response);

        const [processed] = await db.query("SELECT batch_id FROM settlement_batches");
        const processedIds = new Set(processed.map(p => String(p.batch_id)));

        const pendingBatches = apiBatches
            .map(b => {
                const id = b.id || b.payment_id || b.batch_id || b.invoice || 'Unknown';
                const amount = parseFloat(b.cod_amount || b.amount || b.total_amount || b.total_collection || b.net_amount || 0);
                
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

// 2. [STEP 1] Verify Batch (Upload File -> Return Preview Data)
exports.verifyBatch = async (req, res) => {
    try {
        const { batch_id } = req.body;
        const file = req.file;

        if (!file) throw new Error("Please upload the payment file.");
        
        if (!file.originalname.includes(batch_id)) {
            throw new Error(`Filename mismatch! It must contain the Batch ID: ${batch_id}`);
        }

        // A. Fetch API Data
        const response = await steadfast.getPaymentDetails(batch_id);
        const apiItems = findDataArray(response);
        
        if (apiItems.length === 0) throw new Error("API returned no orders for this batch.");

        // B. Parse Uploaded File (Supports CSV & Excel)
        let fileRows = [];

        if (file.originalname.endsWith('.xlsx') || file.originalname.endsWith('.xls')) {
            // [NEW] Parse Excel File
            const workbook = xlsx.read(file.buffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0]; // Read first sheet
            fileRows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
            console.log(`Parsed ${fileRows.length} rows from Excel file.`);
        } else {
            // [EXISTING] Parse CSV File
            fileRows = parseCSV(file.buffer);
            console.log(`Parsed ${fileRows.length} rows from CSV file.`);
        }

        const fileMap = {};
        
        if (fileRows.length > 0) {
            // 1. Detect correct column names dynamically
            const sampleRow = fileRows[0];
            const keys = Object.keys(sampleRow);
            
            // Look for keys IGNORING CASE and partial matches
            const invoiceHeader = keys.find(k => k.trim().toLowerCase().includes('invoice'));
            const shippingHeader = keys.find(k => k.trim().toLowerCase().includes('shipping') || k.trim().toLowerCase().includes('charge')); 
            const codHeader = keys.find(k => k.trim().toLowerCase().includes('cod') || k.trim().toLowerCase().includes('amount'));

            console.log("Detected Headers:", { invoiceHeader, shippingHeader, codHeader });

            if (!invoiceHeader) {
                // [DEBUG] Show what we actually found to help debugging
                throw new Error(`Could not find 'Invoice' column. Found headers: ${keys.join(', ')}`);
            }

            // 2. Build the map
            fileRows.forEach(row => {
                const rawInvoice = row[invoiceHeader];
                if (rawInvoice) {
                    const cleanInvoice = rawInvoice.toString().trim(); // Critical: Trim whitespace
                    
                    fileMap[cleanInvoice] = {
                        shipping: parseFloat(row[shippingHeader] || 0),
                        cod: parseFloat(row[codHeader] || 0)
                    };
                }
            });
        }
        
        console.log(`Built map for ${Object.keys(fileMap).length} invoices.`);

        // C. Merge & Verify
        const verifiedItems = [];
        let summary = { 
            total_orders: 0, 
            total_cod: 0, 
            total_delivery: 0, 
            total_fee: 0, 
            net_payout: 0 
        };

        for (const apiItem of apiItems) {
            const invoice = apiItem.invoice || apiItem.invoice_id; 
            if (!invoice) continue;

            const cleanApiInvoice = invoice.toString().trim(); // Trim API invoice too
            const fileData = fileMap[cleanApiInvoice];
            
            if (!fileData) {
                console.warn(`Missing in file: ${cleanApiInvoice}. Available keys example:`, Object.keys(fileMap).slice(0, 3));
                throw new Error(`Order ${cleanApiInvoice} found in API but MISSING in uploaded file.`);
            }

            const apiCOD = parseFloat(apiItem.cod_amount || 0);
            
            // Security Check
            if (Math.abs(apiCOD - fileData.cod) > 1) { 
                throw new Error(`COD Mismatch for ${invoice}! API: ${apiCOD}, File: ${fileData.cod}`);
            }

            const deliveryCharge = fileData.shipping;
            const grossCOD = apiCOD;

            let baseForFee = grossCOD - deliveryCharge;
            if (baseForFee < 0) baseForFee = 0;
            const codFee = baseForFee * 0.01;

            const net = grossCOD - deliveryCharge - codFee;

            verifiedItems.push({
                invoice: invoice,
                cod: grossCOD,
                delivery: deliveryCharge,
                fee: codFee,
                net: net
            });

            summary.total_cod += grossCOD;
            summary.total_delivery += deliveryCharge;
            summary.total_fee += codFee;
        }

        summary.total_orders = verifiedItems.length;

        if (response.total) {
            summary.net_payout = parseFloat(response.total);
        } else if (response.data && response.data.total) {
            summary.net_payout = parseFloat(response.data.total);
        } else {
            summary.net_payout = summary.total_cod - summary.total_delivery - summary.total_fee;
        }

        res.json({ success: true, items: verifiedItems, summary: summary });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
};

// 3. [STEP 2] Process Batch (Confirm Preview -> Update DB)
exports.processBatch = async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const { batch_id, target_account_id, verified_items, final_amount } = req.body;

        const [exists] = await conn.query("SELECT id FROM settlement_batches WHERE batch_id = ?", [batch_id]);
        if (exists.length > 0) throw new Error("This batch has already been processed.");

        console.log(`Processing ${verified_items.length} verified orders for Batch ${batch_id}`);

        let processedCount = 0;

        for (const item of verified_items) {
            await conn.query(`
                UPDATE orders 
                SET status = 'delivered', 
                    payment_status = 'paid',
                    paid_amount = ?,  /* [FIX] Mark as fully paid so it counts as revenue */
                    courier_delivery_charge = ?,
                    cod_received = ?, 
                    gateway_fee = gateway_fee + ?,
                    settled_at = NOW(),
                    bank_account_id = ?
                WHERE order_number = ?
            `, [item.cod, item.delivery, item.cod, item.fee, target_account_id, item.invoice]);

            processedCount++;
        }

        const depositAmount = parseFloat(final_amount);
        if (depositAmount > 0) {
            await conn.query(`UPDATE bank_accounts SET current_balance = current_balance + ? WHERE id = ?`, [depositAmount, target_account_id]);
        }

        await conn.query(`INSERT INTO settlement_batches (batch_id, amount, deposit_account_id) VALUES (?, ?, ?)`, [batch_id, depositAmount, target_account_id]);

        await conn.commit();
        res.json({ success: true, message: `Successfully processed ${processedCount} orders. Deposited: ৳${depositAmount.toLocaleString()}` });

    } catch (err) {
        await conn.rollback();
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        conn.release();
    }
};
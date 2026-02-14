const db = require('../config/database');

// --- TABS LOGIC ---

// 1. Tab: SNS Marketing
exports.getSnsPage = async (req, res) => {
    try {
        const [accounts] = await db.query("SELECT * FROM bank_accounts WHERE status = 'active' ORDER BY account_name ASC");
        
        // --- NEW: Fetch imported SNS history & calculate totals ---
        const [history] = await db.query("SELECT * FROM sns_ad_transactions ORDER BY imported_at DESC");
        
        let totalUsd = 0;
        let totalBdt = 0;
        
        history.forEach(item => {
            totalUsd += parseFloat(item.amount_usd) || 0;
            totalBdt += parseFloat(item.bdt_cost) || 0;
        });

        res.render('admin/accounts/marketing_sns', { 
            title: 'SNS Marketing', 
            layout: 'admin/layout', 
            activeTab: 'sns', 
            accounts,
            history,       // Send the history to the view
            totalUsd,      // Send Total USD
            totalBdt       // Send Total BDT
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Server Error");
    }
};

// 1A. Parse Meta CSV (AJAX)
exports.parseSnsCsv = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });

        const csvData = req.file.buffer.toString('utf8');
        const lines = csvData.split(/\r?\n/);
        
        let isParsing = false;
        let items = [];
        let totalFound = 0, totalDuplicate = 0, totalNew = 0, totalUsd = 0;

        const [existing] = await db.query("SELECT transaction_id FROM sns_ad_transactions");
        const existingIds = existing.map(e => e.transaction_id);

        // Track dynamic CSV formats
        let globalPaymentMethod = "Unknown";
        let amountIndex = 3; 
        let paymentMethodIndex = 2;
        let hasPaymentColumn = true;

        for (let line of lines) {
            if (!line.trim()) continue;
            if (line.includes('Total amount billed')) break;

            // Capture the global payment method (Format 2)
            if (line.startsWith('Payment Method:')) {
                globalPaymentMethod = line.replace('Payment Method:', '').replace(/,/g, '').trim();
            }

            const cols = line.split(',');

            // Detect header and set format rules
            if (cols[0]?.trim() === 'Date' && cols[1]?.trim() === 'Transaction ID') {
                isParsing = true;
                
                if (cols[2]?.trim() === 'Amount') {
                    hasPaymentColumn = false; // It's Format 2 (No payment column)
                    amountIndex = 2;
                } else if (cols[3]?.trim() === 'Amount') {
                    hasPaymentColumn = true; // It's Format 1 (Standard)
                    amountIndex = 3;
                    paymentMethodIndex = 2;
                }
                continue;
            }

            if (isParsing && cols.length >= 3) {
                const date = cols[0].trim();
                const trxId = cols[1].trim();
                
                if (!trxId || trxId === '') continue;

                // Dynamically fetch payment method based on the layout
                let paymentMethod = hasPaymentColumn ? cols[paymentMethodIndex].trim() : globalPaymentMethod;
                let amount = parseFloat(cols[amountIndex].trim());

                if (paymentMethod === 'N/A') continue; // Skip ad credits

                totalFound++;
                const isDuplicate = existingIds.includes(trxId);
                
                if (isDuplicate) {
                    totalDuplicate++;
                } else {
                    totalNew++;
                    totalUsd += amount;
                    // Pass the captured payment method to the frontend
                    items.push({ date, trx_id: trxId, usd_amount: amount, payment_method: paymentMethod });
                }
            }
        }

        res.json({ success: true, stats: { totalFound, totalDuplicate, totalNew, totalUsd }, items });
    } catch (err) {
        console.error("CSV Parse Error:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};

// 1B. Import & Process Expenses (AJAX)
exports.importSnsExpenses = async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const { items, payments } = req.body;
        
        // 1. Generate Master NBTRX ID
        const [settings] = await conn.query("SELECT last_nb_trx_sequence FROM shop_settings LIMIT 1");
        const nextSeq = (settings[0].last_nb_trx_sequence || 0) + 1;
        const nbTrxId = `NBTRX${String(nextSeq).padStart(4, '0')}`;
        await conn.query("UPDATE shop_settings SET last_nb_trx_sequence = ?", [nextSeq]);

        // 2. Save Trx IDs to prevent future duplicates
        for (let item of items) {
            await conn.query(`
                INSERT INTO sns_ad_transactions (transaction_id, date, amount_usd, bdt_cost) 
                VALUES (?, ?, ?, ?)
            `, [item.trx_id, item.date, item.usd_amount, item.bdt_amount]);
        }

        // 3. Process Payments (Deduct from Accounts & Create Expenses)
        for (let pay of payments) {
            const accId = pay.account_id;
            const amt = parseFloat(pay.amount);

            // Deduct from bank
            const [acc] = await conn.query("SELECT account_name, current_balance FROM bank_accounts WHERE id = ?", [accId]);
            if (acc[0].current_balance < amt) throw new Error(`Insufficient funds in ${acc[0].account_name}`);
            await conn.query("UPDATE bank_accounts SET current_balance = current_balance - ? WHERE id = ?", [amt, accId]);

            // Capture exact importing Date & Time
            const importTimestamp = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', dateStyle: 'medium', timeStyle: 'medium' });

            // Create Expense record (NOW() explicitly saves the exact database timestamp to created_at)
            await conn.query(`
                INSERT INTO expenses (title, amount, category, account_id, expense_date, note, nb_trx_id, created_at)
                VALUES (?, ?, 'marketing', ?, CURDATE(), ?, ?, NOW())
            `, [
                `Meta Ads Import`, 
                amt, 
                accId, 
                `Imported on: ${importTimestamp} | Paid via ${acc[0].account_name}. Included ${items.length} ad transactions.`,
                nbTrxId
            ]);
        }

        await conn.commit();
        res.json({ success: true, message: "Import successful" });
    } catch (err) {
        await conn.rollback();
        console.error("Import Error:", err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        conn.release();
    }
};

// 2. Tab: Marketing & PR Vault
exports.getVaultPage = async (req, res) => {
    try {
        const [expenseData] = await db.query(`SELECT SUM(amount) as total FROM expenses WHERE category = 'marketing'`);
        const totalExpense = expenseData[0].total || 0;

        // Fetch Vault Items (Auto-matching the best image per variant color)
        const [vaultItems] = await db.query(`
            SELECT m.*, p.name as product_name, pv.sku, pv.color, pv.size,
                   (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY (pi.color_name = pv.color) DESC LIMIT 1) as image
            FROM marketing_vault m
            JOIN products p ON m.product_id = p.id
            JOIN product_variants pv ON m.variant_id = pv.id
            WHERE m.status = 'active'
            ORDER BY m.created_at DESC
        `);

        res.render('admin/accounts/marketing_vault', { title: 'Marketing & PR Vault', layout: 'admin/layout', totalExpense, vaultItems, activeTab: 'vault' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

// 3. Tab: Other Marketing
exports.getOtherPage = async (req, res) => {
    res.render('admin/accounts/marketing_other', { title: 'Other Marketing', layout: 'admin/layout', activeTab: 'other' });
};


// --- VAULT ACTIONS & AJAX ---

// 4. AJAX: Search Products by SKU/Name
exports.searchVaultProduct = async (req, res) => {
    const { q } = req.query;
    try {
        const [products] = await db.query(`SELECT id, name, sku FROM products WHERE sku LIKE ? OR name LIKE ? LIMIT 15`, [`%${q}%`, `%${q}%`]);

        for (let p of products) {
            const [variants] = await db.query(`
                SELECT pv.id, pv.color, pv.size, pv.sku, pv.stock_quantity,
                       (SELECT image_url FROM product_images pi WHERE pi.product_id = pv.product_id ORDER BY (pi.color_name = pv.color) DESC LIMIT 1) as image
                FROM product_variants pv
                WHERE pv.product_id = ? AND pv.stock_quantity > 0
            `, [p.id]);
            p.variants = variants;
        }

        res.json({ success: true, products });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 5. Transfer Item to Vault
exports.transferToVault = async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const { variant_id, quantity, reason } = req.body;
        const qty = parseInt(quantity);

        const [variant] = await conn.query("SELECT product_id, cost_price, stock_quantity FROM product_variants WHERE id = ?", [variant_id]);
        if (variant.length === 0 || variant[0].stock_quantity < qty) throw new Error("Insufficient stock.");
        
        // --- FIXED: Get the actual cost from active inventory batch ---
        const [batches] = await conn.query(`
            SELECT buying_price 
            FROM inventory_batches 
            WHERE variant_id = ? AND remaining_quantity > 0 
            ORDER BY created_at ASC LIMIT 1
        `, [variant_id]);

        // Use batch buying_price if available, otherwise fallback to variant cost_price
        const costPrice = batches.length > 0 ? parseFloat(batches[0].buying_price) : parseFloat(variant[0].cost_price);
        // --------------------------------------------------------------
        
        // Deduct Stock
        await conn.query("UPDATE product_variants SET stock_quantity = stock_quantity - ? WHERE id = ?", [qty, variant_id]);
        await conn.query("UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?", [qty, variant[0].product_id]);

        // Create Expense & Add to Vault
        const [expense] = await conn.query(`INSERT INTO expenses (title, amount, category, expense_date, note) VALUES (?, ?, 'marketing', CURDATE(), ?)`, [`Internal Transfer: ${reason}`, (costPrice * qty), `${qty} units @ ৳${costPrice}`]);
        await conn.query(`INSERT INTO marketing_vault (product_id, variant_id, quantity, cost_price, reason, expense_id) VALUES (?, ?, ?, ?, ?, ?)`, [variant[0].product_id, variant_id, qty, costPrice, reason, expense.insertId]);

        await conn.commit();
        res.redirect('/admin/accounts/marketing/vault?success=Item transferred to Vault');
    } catch (err) {
        await conn.rollback();
        res.redirect('/admin/accounts/marketing/vault?error=' + encodeURIComponent(err.message));
    } finally {
        conn.release();
    }
};

// 6. Return Item from Vault
exports.returnFromVault = async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const { vault_id } = req.body;

        const [vault] = await conn.query("SELECT * FROM marketing_vault WHERE id = ? AND status = 'active'", [vault_id]);
        if (vault.length === 0) throw new Error("Item not found or already returned.");
        const item = vault[0];

        // Restore Stock & Delete Expense
        await conn.query("UPDATE product_variants SET stock_quantity = stock_quantity + ? WHERE id = ?", [item.quantity, item.variant_id]);
        await conn.query("UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?", [item.quantity, item.product_id]);
        if (item.expense_id) await conn.query("DELETE FROM expenses WHERE id = ?", [item.expense_id]);
        await conn.query("UPDATE marketing_vault SET status = 'returned', returned_at = NOW() WHERE id = ?", [vault_id]);

        await conn.commit();
        res.redirect('/admin/accounts/marketing/vault?success=Item returned to stock');
    } catch (err) {
        await conn.rollback();
        res.redirect('/admin/accounts/marketing/vault?error=' + encodeURIComponent(err.message));
    } finally {
        conn.release();
    }
};
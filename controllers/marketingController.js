const db = require('../config/database');

// --- TABS LOGIC ---

// 1. Tab: SNS Marketing
exports.getSnsPage = async (req, res) => {
    res.render('admin/accounts/marketing_sns', { title: 'SNS Marketing', layout: 'admin/layout', activeTab: 'sns' });
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
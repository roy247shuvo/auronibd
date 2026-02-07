const db = require('../config/database');

// 1. List All Purchase Orders (With Search & Filter)
exports.getPOList = async (req, res) => {
    try {
        const { q, vendor } = req.query;

        // Start with base query
        let sql = `
            SELECT po.*, v.name as vendor_name 
            FROM purchase_orders po
            LEFT JOIN vendors v ON po.vendor_id = v.id
            WHERE 1=1
        `;
        
        const params = [];

        // Add Search Logic (PO Number)
        if (q) {
            sql += ` AND po.po_number LIKE ?`;
            params.push(`%${q}%`);
        }

        // Add Vendor Filter
        if (vendor) {
            sql += ` AND po.vendor_id = ?`;
            params.push(vendor);
        }

        // Finalize Sort
        sql += ` ORDER BY po.created_at DESC`;

        const [orders] = await db.query(sql, params);
        
        const [vendors] = await db.query("SELECT * FROM vendors ORDER BY name ASC");
        const [accounts] = await db.query("SELECT * FROM bank_accounts WHERE status = 'active' ORDER BY account_name ASC");
        
        // [NEW] Fetch Categories for Material PO Modal
        const [categories] = await db.query("SELECT * FROM material_categories ORDER BY name ASC");

        res.render('admin/orders/purchase_orders', { 
            title: 'Purchase Orders',
            orders, 
            vendors,
            accounts,
            categories, // [NEW] Passed to view
            query: req.query 
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading PO list");
    }
};

// 2. Search Product for PO (Modal 1)
exports.searchProductForPO = async (req, res) => {
    try {
        const query = req.query.q;
        // Search by Name or SKU (Main Product only)
        const [products] = await db.query(`
            SELECT DISTINCT p.id, p.name, p.sku, p.stock_quantity, 
            (SELECT image_url FROM product_images WHERE product_id = p.id LIMIT 1) as image
            FROM products p
            LEFT JOIN product_variants pv ON p.id = pv.product_id
            WHERE p.name LIKE ? OR p.sku LIKE ? OR pv.sku LIKE ?
            LIMIT 10
        `, [`%${query}%`, `%${query}%`, `%${query}%`]);

        res.json(products);
    } catch (err) {
        res.status(500).json({ error: "Search failed" });
    }
};


// [NEW] 3. Get Raw Materials for PO (API for Modal)
exports.getMaterialsForPO = async (req, res) => {
    try {
        const catId = req.query.category_id;
        
        // Fetch Materials + Variants
        const [materials] = await db.query(`
            SELECT m.id as mat_id, m.name as mat_name, m.unit,
                   v.id as var_id, v.name as var_name, v.stock_quantity
            FROM raw_materials m
            JOIN raw_material_variants v ON m.id = v.raw_material_id
            WHERE m.category_id = ?
            ORDER BY m.name, v.name
        `, [catId]);

        res.json(materials);
    } catch (err) {
        res.status(500).json({ error: "Failed to load materials" });
    }
};

// 4. Get Variants for Snapshot (Modal 2)
exports.getProductVariantsSnapshot = async (req, res) => {
    try {
        const productId = req.params.id;
        
        // 1. Get Product & Variants
        const [variants] = await db.query(`
            SELECT v.*, p.name as product_name, p.sku as product_sku
            FROM product_variants v
            JOIN products p ON v.product_id = p.id
            WHERE v.product_id = ?
        `, [productId]);

        // 2. Get Next Batch Number (Count existing batches + 1)
        const [batchCount] = await db.query("SELECT COUNT(*) as c FROM inventory_batches WHERE product_id = ?", [productId]);
        const nextBatchNum = batchCount[0].c + 1;

        // 3. Calculate Real Stock & Price Range
        for (let v of variants) {
            const [batches] = await db.query(`
                SELECT MIN(buying_price) as min_price, MAX(buying_price) as max_price, SUM(remaining_quantity) as total_stock
                FROM inventory_batches 
                WHERE variant_id = ? AND remaining_quantity > 0
            `, [v.id]);

            v.real_stock = batches[0].total_stock || 0;
            v.price_range = batches[0].min_price ? `${batches[0].min_price} - ${batches[0].max_price}` : 'N/A';
        }

        res.json({ success: true, variants, nextBatchNum });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to load variants" });
    }
};

// 5. Create Purchase Order (Final Save)
exports.createPurchaseOrder = async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        
        // [UPDATED] Added 'type' destructuring
        const { vendor_id, items, payment, type } = req.body; 
        const poType = type || 'product';

        // Generate PO Number
        const poNumber = 'PO-' + Date.now();
        
        // Calculate Total
        let totalAmount = 0;
        items.forEach(item => totalAmount += (item.qty * item.cost));

        const paidAmount = payment ? parseFloat(payment.amount) : 0;
        const createdBy = req.session.user ? req.session.user.name : 'System';

        // 1. Insert Header [UPDATED] Added 'type' column
        const [poResult] = await conn.query(`
            INSERT INTO purchase_orders (po_number, vendor_id, total_amount, paid_amount, status, type)
            VALUES (?, ?, ?, ?, 'pending', ?)
        `, [poNumber, vendor_id, totalAmount, paidAmount, poType]);
        
        const poId = poResult.insertId;

        // 2. Insert Items [UPDATED] Check type
        for (const item of items) {
            if (poType === 'product') {
                await conn.query(`
                    INSERT INTO purchase_order_items (po_id, product_id, variant_id, quantity, buying_price)
                    VALUES (?, ?, ?, ?, ?)
                `, [poId, item.product_id, item.variant_id, item.qty, item.cost]);
            } else {
                // Raw Material Item (item.id is variant_id)
                // Fetch parent material ID first
                const [vData] = await conn.query("SELECT raw_material_id FROM raw_material_variants WHERE id = ?", [item.id]);
                const parentId = vData[0]?.raw_material_id;

                await conn.query(`
                    INSERT INTO purchase_order_items (po_id, raw_material_id, raw_material_variant_id, quantity, buying_price)
                    VALUES (?, ?, ?, ?, ?)
                `, [poId, parentId, item.id, item.qty, item.cost]);
            }
        }

        // 3. Handle Payment (If Added)
        if (payment && paidAmount > 0) {
            await conn.query("UPDATE bank_accounts SET current_balance = current_balance - ? WHERE id = ?", [paidAmount, payment.accountId]);
            
            // --- NEW: Generate Internal NB TRX ID ---
            const [settings] = await conn.query("SELECT last_nb_trx_sequence FROM shop_settings LIMIT 1");
            const nextSeq = (settings[0].last_nb_trx_sequence || 0) + 1;
            const nbTrxId = `NBTRX${String(nextSeq).padStart(4, '0')}`;
            await conn.query("UPDATE shop_settings SET last_nb_trx_sequence = ?", [nextSeq]);

            // Record Payment Log (Saving both IDs)
            await conn.query(`
                INSERT INTO vendor_payments (nb_trx_id, po_id, account_id, amount, payment_date, created_by, trx_id, note)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [nbTrxId, poId, payment.accountId, paidAmount, payment.date, createdBy, payment.trxId || null, "Initial Payment"]);
        }

        await conn.commit();
        res.json({ success: true, message: "PO Created Successfully" });

    } catch (err) {
        await conn.rollback();
        console.error(err);
        res.status(500).json({ error: "Failed to create PO" });
    } finally {
        conn.release();
    }
};

// 6. Receive PO (The Logic that adds STOCK)
exports.receivePurchaseOrder = async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const poId = req.params.id;

        // Get PO Items
        const [items] = await conn.query("SELECT * FROM purchase_order_items WHERE po_id = ?", [poId]);
        const [po] = await conn.query("SELECT * FROM purchase_orders WHERE id = ?", [poId]);

        if(po[0].status === 'received') throw new Error("PO already received");

        // === TYPE A: PRODUCTS (Creates Batches) ===
        if (po[0].type === 'product') {
            for (const item of items) {
                const [bCount] = await conn.query("SELECT COUNT(*) as c FROM inventory_batches WHERE product_id = ?", [item.product_id]);
                const batchNum = `BATCH-${item.product_id}-${bCount[0].c + 1}`;

                await conn.query(`
                    INSERT INTO inventory_batches 
                    (batch_number, product_id, variant_id, po_id, vendor_id, buying_price, initial_quantity, remaining_quantity)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [batchNum, item.product_id, item.variant_id, poId, po[0].vendor_id, item.buying_price, item.quantity, item.quantity]);

                await conn.query(`UPDATE product_variants SET stock_quantity = stock_quantity + ? WHERE id = ?`, [item.quantity, item.variant_id]);
                await conn.query(`UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?`, [item.quantity, item.product_id]);
            }
        } 
        // === TYPE B: MATERIALS (Updates AVCO) ===
        else {
            for (const item of items) {
                const variantId = item.raw_material_variant_id;
                const newQty = parseFloat(item.quantity);
                const newCost = parseFloat(item.buying_price);
                const newTotalValue = newQty * newCost;

                // 1. Get Current State
                const [v] = await conn.query("SELECT stock_quantity, average_cost, raw_material_id FROM raw_material_variants WHERE id = ? FOR UPDATE", [variantId]);
                
                const currentQty = parseFloat(v[0].stock_quantity || 0);
                const currentAvg = parseFloat(v[0].average_cost || 0);
                const currentTotalValue = currentQty * currentAvg;

                // 2. Calculate New Weighted Average
                const finalTotalQty = currentQty + newQty;
                const finalAvgCost = finalTotalQty > 0 ? ((currentTotalValue + newTotalValue) / finalTotalQty) : 0;

                // 3. Update Database
                await conn.query(`
                    UPDATE raw_material_variants SET stock_quantity = ?, average_cost = ? WHERE id = ?
                `, [finalTotalQty, finalAvgCost, variantId]);

                // 4. Log
                await conn.query(`
                    INSERT INTO raw_material_logs (raw_material_id, variant_id, type, quantity_change, cost_price, reference_id, created_at)
                    VALUES (?, ?, 'purchase', ?, ?, ?, NOW())
                `, [v[0].raw_material_id, variantId, newQty, newCost, poId]);
            }
        }

        // Mark PO as Received
        await conn.query("UPDATE purchase_orders SET status = 'received', received_at = NOW() WHERE id = ?", [poId]);

        await conn.commit();
        res.json({ success: true, message: "Stock Received & Batches Created" });

    } catch (err) {
        await conn.rollback();
        console.error(err);
        res.status(500).json({ error: err.message });
    } finally {
        conn.release();
    }
};

// 7. NEW: Add Payment to Existing PO
exports.addPayment = async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        // Added trx_id to destructuring
        const { po_id, account_id, amount, date, note, trx_id } = req.body; 
        const payAmount = parseFloat(amount);
        const createdBy = req.session.user ? req.session.user.name : 'System';

        await conn.query("UPDATE bank_accounts SET current_balance = current_balance - ? WHERE id = ?", [payAmount, account_id]);
        await conn.query("UPDATE purchase_orders SET paid_amount = paid_amount + ? WHERE id = ?", [payAmount, po_id]);

        // --- NEW: Generate Internal NB TRX ID ---
        const [settings] = await conn.query("SELECT last_nb_trx_sequence FROM shop_settings LIMIT 1");
        const nextSeq = (settings[0].last_nb_trx_sequence || 0) + 1;
        const nbTrxId = `NBTRX${String(nextSeq).padStart(4, '0')}`;
        await conn.query("UPDATE shop_settings SET last_nb_trx_sequence = ?", [nextSeq]);

        // Insert
        await conn.query(`
            INSERT INTO vendor_payments (nb_trx_id, po_id, account_id, amount, payment_date, note, created_by, trx_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [nbTrxId, po_id, account_id, payAmount, date, note, createdBy, trx_id || null]);

        await conn.commit();
        res.json({ success: true });

    } catch (err) {
        await conn.rollback();
        console.error(err);
        res.status(500).json({ error: "Payment failed" });
    } finally {
        conn.release();
    }
};

// 8. NEW: Get PO Details (Grouped by Product)
exports.getPODetails = async (req, res) => {
    try {
        const poId = req.params.id;

        // 1. Fetch Header Info
        const [po] = await db.query(`
            SELECT po.*, v.name as vendor_name 
            FROM purchase_orders po
            LEFT JOIN vendors v ON po.vendor_id = v.id
            WHERE po.id = ?
        `, [poId]);

        if (po.length === 0) return res.status(404).json({ error: "PO not found" });

        // 2. Fetch Items based on Type
        let items = [];
        if (po[0].type === 'product') {
            [items] = await db.query(`
                SELECT poi.*, p.name as product_name, pv.sku as variant_sku, pv.color, pv.size, ib.batch_number
                FROM purchase_order_items poi
                JOIN products p ON poi.product_id = p.id
                LEFT JOIN product_variants pv ON poi.variant_id = pv.id
                LEFT JOIN inventory_batches ib ON (poi.po_id = ib.po_id AND poi.variant_id = ib.variant_id)
                WHERE poi.po_id = ?
            `, [poId]);
        } else {
            [items] = await db.query(`
                SELECT poi.*, m.name as product_name, v.name as variant_sku, m.unit as size
                FROM purchase_order_items poi
                JOIN raw_materials m ON poi.raw_material_id = m.id
                LEFT JOIN raw_material_variants v ON poi.raw_material_variant_id = v.id
                WHERE poi.po_id = ?
            `, [poId]);
        }

        // 3. Group Items by Product
        const groupedItems = {};
        let totalItemCount = 0;

        items.forEach(item => {
            if (!groupedItems[item.product_id]) {
                groupedItems[item.product_id] = {
                    product_name: item.product_name,
                    batch_number: item.batch_number || 'Pending', // Show Pending if not received
                    variants: []
                };
            }
            // Use specific batch if available per variant, otherwise fall back to product group batch
            groupedItems[item.product_id].variants.push({
                sku: item.variant_sku,
                color: item.color,
                size: item.size,
                buying_price: item.buying_price,
                qty: item.quantity,
                line_total: item.line_total
            });
            totalItemCount += item.quantity;
        });

        // 4. Fetch Transaction History
        const [transactions] = await db.query(`
            SELECT vp.*, ba.account_name
            FROM vendor_payments vp
            LEFT JOIN bank_accounts ba ON vp.account_id = ba.id
            WHERE vp.po_id = ?
            ORDER BY vp.payment_date DESC
        `, [poId]);

        res.json({ 
            success: true, 
            po: po[0], 
            items: groupedItems, 
            totalItemCount,
            transactions 
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to load details" });
    }
};
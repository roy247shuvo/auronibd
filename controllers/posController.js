const db = require('../config/database');

// 1. Render POS Page (Standard)
exports.getPOS = async (req, res) => {
    try {
        // === 1. ZOMBIE KILLER (Global Safety Net - 2 Hours) ===
        // Checks for any holds older than 2 hours from ANY user (crashed PCs)
        const [zombies] = await db.query("SELECT * FROM pos_holds WHERE created_at < (NOW() - INTERVAL 2 HOUR)");
        
        if (zombies.length > 0) {
            for (const z of zombies) {
                // Restore Stock
                await db.query("UPDATE product_variants SET stock_quantity = stock_quantity + ? WHERE id = ?", [z.quantity, z.variant_id]);
                await db.query("UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?", [z.quantity, z.product_id]);
            }
            // Delete the expired holds
            await db.query("DELETE FROM pos_holds WHERE created_at < (NOW() - INTERVAL 2 HOUR)");
        }

        // === 2. CURRENT SESSION RESET (User Specific) ===
        // --- NEW: Clear previous holds for this user (Restore stock from crashed sessions) ---
        const userId = req.session.user.id;
        const [staleHolds] = await db.query("SELECT * FROM pos_holds WHERE user_id = ?", [userId]);

        for (const hold of staleHolds) {
            await db.query("UPDATE product_variants SET stock_quantity = stock_quantity + ? WHERE id = ?", [hold.quantity, hold.variant_id]);
            await db.query("UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?", [hold.quantity, hold.product_id]);
        }
        await db.query("DELETE FROM pos_holds WHERE user_id = ?", [userId]);

        const [categories] = await db.query("SELECT * FROM categories WHERE status='active'");
        const [brands] = await db.query("SELECT * FROM brands");
        
        // 1. Fetch Real Banks (Exclude Cash & MFS)
        const [banks] = await db.query(`
            SELECT * FROM bank_accounts 
            WHERE status='active' 
            AND bank_name NOT IN ('Cash', 'Bkash', 'Nagad', 'Rocket', 'Upay', 'Mobile Banking')
        `);

        // 2. Fetch MFS Accounts (Mobile Banking, Bkash, Nagad, etc.)
        const [mfs] = await db.query(`
            SELECT * FROM bank_accounts 
            WHERE status='active' 
            AND bank_name IN ('Bkash', 'Nagad', 'Rocket', 'Upay', 'Mobile Banking')
        `);
        
        const [products] = await db.query(`
            SELECT p.id, p.name, p.stock_quantity, 
                   (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY sort_order ASC LIMIT 1) as image,
                   (SELECT COUNT(*) FROM product_variants WHERE product_id = p.id) as variant_count
            FROM products p WHERE p.is_online = 'yes' ORDER BY p.name ASC LIMIT 40
        `);

        res.render('admin/pos/index', {
            title: 'POS Terminal',
            layout: 'admin/layout',
            categories, brands, banks, mfs, initialProducts: products // Passed 'mfs'
        });
    } catch (err) { console.error(err); res.send("Error loading POS"); }
};

// 2. Render POS Full Screen
exports.getPOSFullscreen = async (req, res) => {
    try {
        const [categories] = await db.query("SELECT * FROM categories WHERE status='active'");
        const [brands] = await db.query("SELECT * FROM brands");
        
        // 1. Fetch Real Banks
        const [banks] = await db.query(`
            SELECT * FROM bank_accounts 
            WHERE status='active' 
            AND bank_name NOT IN ('Cash', 'Bkash', 'Nagad', 'Rocket', 'Upay', 'Mobile Banking')
        `);

        // 2. Fetch MFS Accounts
        const [mfs] = await db.query(`
            SELECT * FROM bank_accounts 
            WHERE status='active' 
            AND bank_name IN ('Bkash', 'Nagad', 'Rocket', 'Upay', 'Mobile Banking')
        `);
        
        const [products] = await db.query(`
            SELECT p.id, p.name, p.stock_quantity, 
                   (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY sort_order ASC LIMIT 1) as image,
                   (SELECT COUNT(*) FROM product_variants WHERE product_id = p.id) as variant_count
            FROM products p WHERE p.is_online = 'yes' ORDER BY p.name ASC LIMIT 40
        `);

        res.render('admin/pos/fullscreen', {
            title: 'POS Full Screen',
            layout: false,
            categories, brands, banks, mfs, initialProducts: products // Passed 'mfs'
        });
    } catch (err) { console.error(err); res.send("Error loading POS"); }
};

// --- NEW: POS Sale History ---
exports.getPosHistory = async (req, res) => {
    try {
        const currentStatus = req.query.status || 'all';
        
        // 1. Get Status Counts (Only for POS Source)
        const [counts] = await db.query(`
            SELECT status, COUNT(*) as count 
            FROM orders 
            WHERE order_source = 'pos' 
            AND status IN ('POS Complete', 'POS Cancelled', 'POS Partial')
            GROUP BY status
        `);
        
        const statusCounts = counts.reduce((acc, row) => { acc[row.status] = row.count; return acc; }, {});
        statusCounts['all'] = Object.values(statusCounts).reduce((a, b) => a + b, 0);

        // 2. Fetch Orders
        let query = `SELECT o.*, c.full_name, c.phone FROM orders o LEFT JOIN customers c ON o.customer_id = c.id WHERE o.order_source = 'pos'`;
        const params = [];

        if (currentStatus !== 'all') {
            query += ` AND o.status = ?`;
            params.push(currentStatus);
        } else {
            query += ` AND o.status IN ('POS Complete', 'POS Cancelled', 'POS Partial')`;
        }
        
        query += ` ORDER BY o.id DESC`;

        // === FIX START: This line was missing ===
        const [orders] = await db.query(query, params); 
        // === FIX END ===

        res.render('admin/pos/history', {
            title: 'POS Sale History',
            layout: 'admin/layout',
            orders, // Now this variable exists!
            statusCounts,
            currentStatus
        });

    } catch (err) { console.error(err); res.send("Error loading history"); }
};

// --- NEW: POS Settings ---
exports.getPosSettings = async (req, res) => {
    try {
        const [settings] = await db.query("SELECT * FROM shop_settings LIMIT 1");
        res.render('admin/pos/settings', {
            title: 'POS Settings',
            layout: 'admin/layout',
            settings: settings[0] || {}
        });
    } catch (err) { console.error(err); res.send("Error loading settings"); }
};

exports.savePosSettings = async (req, res) => {
    try {
        const { pos_paper_width } = req.body;
        
        // Update settings
        await db.query("UPDATE shop_settings SET pos_paper_width = ?", [pos_paper_width]);
        
        // Basic success redirect (you can add flash messages if you have them)
        res.redirect('/admin/pos/pos-setting');
    } catch (err) { console.error(err); res.send("Error saving settings"); }
};

// 3. Search API (FIXED: Mixed Results - Variants & Products)
exports.searchProducts = async (req, res) => {
    try {
        let q = req.query.q;
        if(!q) return res.json([]);
        q = q.trim(); 

        // 1. Search Specific Variants (By Variant SKU)
        const [variants] = await db.query(`
            SELECT pv.id as variant_id, pv.product_id, pv.sku, pv.size, pv.color, pv.price, pv.compare_price, pv.stock_quantity,
                   p.name, 
                   (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY (pi.color_name = pv.color) DESC, sort_order ASC LIMIT 1) as image
            FROM product_variants pv
            JOIN products p ON pv.product_id = p.id
            WHERE p.is_online = 'yes' 
            AND pv.sku LIKE ?
            LIMIT 10
        `, [`%${q}%`]);

        // Format Variants for Frontend
        const variantResults = variants.map(v => {
             const sellingPrice = (parseFloat(v.compare_price) > 0) ? parseFloat(v.compare_price) : parseFloat(v.price);
             return { ...v, selling_price: sellingPrice, type: 'variant' };
        });

        // 2. Search Main Products (By Name or Main SKU)
        const [products] = await db.query(`
            SELECT p.id, p.name, p.stock_quantity, 
                   (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY sort_order ASC LIMIT 1) as image,
                   (SELECT COUNT(*) FROM product_variants WHERE product_id = p.id) as variant_count
            FROM products p 
            WHERE p.is_online = 'yes' 
            AND (p.name LIKE ? OR p.sku LIKE ?)
            LIMIT 20
        `, [`%${q}%`, `%${q}%`]);

        const productResults = products.map(p => ({ ...p, type: 'product' }));

        // 3. Combine Results (Variants first for visibility)
        const combined = [...variantResults, ...productResults];

        res.json(combined);
    } catch (err) { console.error(err); res.status(500).json([]); }
};

// 4. Get Variants
exports.getVariants = async (req, res) => {
    try {
        const productId = req.params.id;
        // ADDED: pv.product_id to the SELECT list
        const [variants] = await db.query(`
            SELECT pv.id as variant_id, pv.product_id, pv.sku, pv.size, pv.color, pv.price, pv.compare_price, pv.stock_quantity,
                   (SELECT image_url FROM product_images pi WHERE pi.product_id = pv.product_id ORDER BY (pi.color_name = pv.color) DESC, sort_order ASC LIMIT 1) as image,
                   p.name
            FROM product_variants pv JOIN products p ON pv.product_id = p.id WHERE pv.product_id = ?
        `, [productId]);

        const processed = variants.map(v => {
            const sellingPrice = (parseFloat(v.compare_price) > 0) ? parseFloat(v.compare_price) : parseFloat(v.price);
            return { ...v, selling_price: sellingPrice };
        });
        res.json(processed);
    } catch (err) { res.status(500).json([]); }
};

// 5. Customer Lookup (FIXED: Improved Guest Name Fallback)
exports.getCustomer = async (req, res) => {
    try {
        const phone = req.query.phone;
        
        // 1. Try Registered Customer Table
        const [customers] = await db.query("SELECT * FROM customers WHERE phone = ?", [phone]);
        
        let customerData = null;
        let customerId = null;

        if(customers.length > 0) {
            customerData = customers[0];
            customerId = customerData.id;
        } else {
            // 2. Fallback: Check past orders for "Guest Name"
            // FIXED: Ensure we don't pick up empty names
            const [guestOrders] = await db.query(`
                SELECT guest_name, shipping_address 
                FROM orders 
                WHERE guest_phone = ? AND guest_name IS NOT NULL AND guest_name != ''
                ORDER BY id DESC LIMIT 1
            `, [phone]);
            
            if(guestOrders.length > 0) {
                customerData = { 
                    id: null, 
                    full_name: guestOrders[0].guest_name, // Map guest_name -> full_name
                    address: guestOrders[0].shipping_address,
                    phone: phone
                };
            }
        }

        if (!customerData) return res.json({ found: false });

        // Calculate LTV
        let query = "";
        let params = [];

        // UPDATED: Include 'POS Complete' and 'POS Partial', exclude 'POS Cancelled'
        const ltvLogic = `SUM(CASE WHEN status IN ('delivered', 'POS Complete', 'POS Partial') THEN total_amount ELSE 0 END)`;

        if (customerId) {
            query = `SELECT COUNT(*) as count, ${ltvLogic} as total FROM orders WHERE customer_id = ?`;
            params = [customerId];
        } else {
            query = `SELECT COUNT(*) as count, ${ltvLogic} as total FROM orders WHERE guest_phone = ?`;
            params = [phone];
        }

        const [stats] = await db.query(query, params);

        res.json({
            found: true,
            customer: customerData, // Frontend expects .full_name
            stats: {
                count: stats[0].count || 0,
                total: stats[0].total || 0
            }
        });
    } catch (err) { console.error(err); res.json({ found: false }); }
};

exports.getCustomerHistory = async (req, res) => {
    try {
        const { id, phone } = req.query; 
        let query = '', param = '';
        if(id && id !== 'null') { query = "SELECT id, order_number, created_at, total_amount, status FROM orders WHERE customer_id = ? ORDER BY id DESC LIMIT 10"; param = id; } 
        else { query = "SELECT id, order_number, created_at, total_amount, status FROM orders WHERE guest_phone = ? ORDER BY id DESC LIMIT 10"; param = phone; }

        const [orders] = await db.query(query, [param]);
        let html = `<div class="overflow-x-auto"><table class="min-w-full text-sm text-left text-gray-500"><thead class="text-xs text-gray-700 uppercase bg-gray-50"><tr><th>Date</th><th>Invoice</th><th>Status</th><th>Total</th></tr></thead><tbody>`;
        orders.forEach(o => { html += `<tr class="bg-white border-b hover:bg-gray-50"><td class="px-3 py-2">${new Date(o.created_at).toLocaleDateString()}</td><td class="px-3 py-2 font-bold text-blue-600 cursor-pointer hover:underline" onclick="viewOrderDetails(${o.id}, '${o.order_number}')">${o.order_number}</td><td class="px-3 py-2">${o.status}</td><td class="px-3 py-2">TK. ${o.total_amount}</td></tr>`; });
        html += `</tbody></table></div>`;
        res.send(html);
    } catch (err) { res.send("Error"); }
};

exports.getOrderDetails = async (req, res) => {
    try {
        const [items] = await db.query(`SELECT oi.*, (SELECT image_url FROM product_images pi WHERE pi.product_id = oi.product_id ORDER BY sort_order ASC LIMIT 1) as image FROM order_items oi WHERE oi.order_id = ?`, [req.params.id]);
        res.json(items);
    } catch (err) { res.status(500).json([]); }
};

exports.submitOrder = async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const { customer_phone, customer_name, customer_address, items, discount, payment_method, amount_received, trx_id, bank_id } = req.body;
        const cartItems = JSON.parse(items);
        
        let customer_id = null;
        if(customer_phone) {
            const [cust] = await conn.query("SELECT id FROM customers WHERE phone = ?", [customer_phone]);
            if(cust.length > 0) {
                customer_id = cust[0].id;
                if(customer_name) await conn.query("UPDATE customers SET full_name = ? WHERE id = ?", [customer_name, customer_id]);
            } else {
                const [newCust] = await conn.query("INSERT INTO customers (full_name, phone, address) VALUES (?, ?, ?)", [customer_name || 'Walk-in', customer_phone, customer_address || '']);
                customer_id = newCust.insertId;
            }
        }

        let product_subtotal = 0;
        const finalItems = [];
        for(let item of cartItems) {
            const [variant] = await conn.query("SELECT price, compare_price FROM product_variants WHERE id = ?", [item.variant_id]);
            if(variant.length > 0) {
                const v = variant[0];
                const finalPrice = (parseFloat(v.compare_price) > 0) ? parseFloat(v.compare_price) : parseFloat(v.price);
                product_subtotal += finalPrice * item.quantity;
                finalItems.push({ ...item, price: finalPrice });
            }
        }
        const discountAmount = parseFloat(discount) || 0;
        const totalAmount = product_subtotal - discountAmount;
        const received = parseFloat(amount_received) || 0;
        const change = (received > totalAmount) ? (received - totalAmount) : 0;

        // 1. Generate POS Invoice Number
        const [settings] = await conn.query("SELECT last_pos_sequence, last_nb_trx_sequence FROM shop_settings LIMIT 1");
        const nextPosSeq = (settings[0].last_pos_sequence || 0) + 1;
        const orderNumber = `NB-POS${String(nextPosSeq).padStart(4, '0')}`;

        // 2. Generate NB Transaction ID (Always for POS)
        const nextTrxSeq = (settings[0].last_nb_trx_sequence || 0) + 1;
        const nbTrxId = `NBTRX${String(nextTrxSeq).padStart(4, '0')}`;

        // 3. Update both sequences
        await conn.query("UPDATE shop_settings SET last_pos_sequence = ?, last_nb_trx_sequence = ?", [nextPosSeq, nextTrxSeq]);

        // --- NEW: DETERMINE DEPOSIT ACCOUNT ---
        let depositAccountId = null;

        if (payment_method === 'cash') {
            // Find 'Cash' account automatically
            const [cashAcc] = await conn.query("SELECT id FROM bank_accounts WHERE bank_name = 'Cash' LIMIT 1");
            if (cashAcc.length > 0) depositAccountId = cashAcc[0].id;
        } else {
            // For Card, MFS, Bank -> Use the selected bank_id
            depositAccountId = bank_id || null;
        }
        
        // --- NEW: CALCULATE GATEWAY FEE ---
        let capturedFee = 0;
        if (depositAccountId) {
            const [account] = await conn.query("SELECT gateway_fee FROM bank_accounts WHERE id = ?", [depositAccountId]);
            if (account.length > 0 && account[0].gateway_fee > 0) {
                // Calculate Fee: Amount Received * (Percentage / 100)
                capturedFee = received * (parseFloat(account[0].gateway_fee) / 100);
            }
        }

        // --- NEW: DUPLICATE TRX CHECK ---
        if (trx_id && trx_id.trim() !== '' && depositAccountId) {
            const [dup] = await conn.query("SELECT id FROM orders WHERE payment_trx_id = ? AND bank_account_id = ?", [trx_id, depositAccountId]);
            if (dup.length > 0) {
                await conn.rollback();
                return res.json({ success: false, message: `⚠️ This Trx ID '${trx_id}' already exists!` });
            }
        }

        const [orderResult] = await conn.query(`
            INSERT INTO orders (order_number, nb_trx_id, customer_id, guest_name, guest_phone, shipping_address, order_source, payment_method, payment_status, status, product_subtotal, total_amount, paid_amount, amount_received, change_return, payment_trx_id, bank_account_id, delivery_area, delivery_charge, gateway_fee)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pos', ?, 'paid', 'POS Complete', ?, ?, ?, ?, ?, ?, ?, ?, 'inside', 0)
        `, [orderNumber, nbTrxId, customer_id, customer_name || 'Guest', customer_phone, customer_address || 'Shop Sale', payment_method, product_subtotal, totalAmount, totalAmount, received, change, trx_id, depositAccountId, capturedFee]);

        const orderId = orderResult.insertId;
        const userId = req.session.user.id;

        for(let item of finalItems) {
            await conn.query(`INSERT INTO order_items (order_id, product_id, variant_id, product_name, sku, size, color, quantity, price, line_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
            [orderId, item.product_id, item.variant_id, item.name, item.sku, item.size, item.color, item.quantity, item.price, (item.price * item.quantity)]);

            // --- NEW: SMART DEDUCTION ---
            // Check if this item was held (reserved)
            const [hold] = await conn.query("SELECT * FROM pos_holds WHERE user_id = ? AND variant_id = ?", [userId, item.variant_id]);
            
            if (hold.length > 0) {
                // Stock was already physically deducted when added to cart.
                // Just remove the hold record so it doesn't get "restored" later.
                await conn.query("DELETE FROM pos_holds WHERE id = ?", [hold[0].id]);
                
                // Handle discrepancy (e.g. if Cart had 5 but Hold had 4)
                const diff = item.quantity - hold[0].quantity;
                if (diff > 0) {
                    await conn.query("UPDATE product_variants SET stock_quantity = stock_quantity - ? WHERE id = ?", [diff, item.variant_id]);
                    await conn.query("UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?", [diff, item.product_id]);
                }
            } else {
                // Fallback: If no hold found (e.g. backend restart), deduct now
                await conn.query("UPDATE product_variants SET stock_quantity = stock_quantity - ? WHERE id = ?", [item.quantity, item.variant_id]);
                await conn.query("UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?", [item.quantity, item.product_id]);
            }
        }

        // --- NEW: DEPOSIT MONEY ---
        // If we found a valid account (Cash or Selected), deposit the money
        if (depositAccountId) {
            await conn.query("UPDATE bank_accounts SET current_balance = current_balance + ? WHERE id = ?", [totalAmount, depositAccountId]);
        }

        await conn.commit();
        
        // FIXED: Added order_id so the frontend can find the receipt
        res.json({ success: true, order_number: orderNumber, order_id: orderId }); 
        
    } catch (err) { await conn.rollback(); res.json({ success: false, message: err.message }); } finally { conn.release(); }
};

// --- Stock Reservation Logic ---

exports.holdStock = async (req, res) => {
    try {
        const { product_id, variant_id, quantity } = req.body;
        const userId = req.session.user.id;

        // 1. Check Availability
        const [variant] = await db.query("SELECT stock_quantity FROM product_variants WHERE id = ?", [variant_id]);
        if (variant.length === 0 || variant[0].stock_quantity < quantity) {
            return res.json({ success: false, message: 'Insufficient Stock' });
        }

        // 2. Deduct Stock
        await db.query("UPDATE product_variants SET stock_quantity = stock_quantity - ? WHERE id = ?", [quantity, variant_id]);
        await db.query("UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?", [quantity, product_id]);

        // 3. Record Hold (Insert or Update)
        await db.query(`
            INSERT INTO pos_holds (user_id, product_id, variant_id, quantity) 
            VALUES (?, ?, ?, ?) 
            ON DUPLICATE KEY UPDATE quantity = quantity + ?
        `, [userId, product_id, variant_id, quantity, quantity]);

        res.json({ success: true });
    } catch (err) { console.error(err); res.json({ success: false, message: err.message }); }
};

exports.releaseStock = async (req, res) => {
    try {
        const { product_id, variant_id, quantity } = req.body;
        const userId = req.session.user.id;

        // 1. Add Stock Back
        await db.query("UPDATE product_variants SET stock_quantity = stock_quantity + ? WHERE id = ?", [quantity, variant_id]);
        await db.query("UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?", [quantity, product_id]);

        // 2. Reduce/Remove Hold
        await db.query(`
            UPDATE pos_holds SET quantity = quantity - ? WHERE user_id = ? AND variant_id = ?
        `, [quantity, userId, variant_id]);
        
        // Cleanup zero quantity holds
        await db.query("DELETE FROM pos_holds WHERE quantity <= 0");

        res.json({ success: true });
    } catch (err) { console.error(err); res.json({ success: false }); }
};

exports.clearHolds = async (req, res) => {
    try {
        const userId = req.session.user.id;
        const [holds] = await db.query("SELECT * FROM pos_holds WHERE user_id = ?", [userId]);
        
        for (const hold of holds) {
            await db.query("UPDATE product_variants SET stock_quantity = stock_quantity + ? WHERE id = ?", [hold.quantity, hold.variant_id]);
            await db.query("UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?", [hold.quantity, hold.product_id]);
        }
        await db.query("DELETE FROM pos_holds WHERE user_id = ?", [userId]);
        res.json({ success: true });
    } catch (err) { res.json({ success: false }); }
};

// --- NEW: Receipt Generation (Corrected Columns) ---
exports.getReceipt = async (req, res) => {
    try {
        const orderId = req.params.id;

        // FIXED: Check for invalid ID before querying
        if (!orderId || orderId === 'undefined' || orderId === 'null') {
            return res.status(400).send("Error: Invalid Order ID. Please check console.");
        }
        
        // 1. Fetch Order & Customer Details
        const [orders] = await db.query(`
            SELECT o.*, 
                   c.full_name as cust_name, c.phone as cust_phone, c.address as cust_address, 
                   ba.bank_name, ba.account_number
            FROM orders o
            LEFT JOIN customers c ON o.customer_id = c.id
            LEFT JOIN bank_accounts ba ON o.bank_account_id = ba.id
            WHERE o.id = ?
        `, [orderId]);

        if (orders.length === 0) return res.status(404).send("Order not found");
        const order = orders[0];

        // 2. Fetch Order Items
        const [items] = await db.query(`SELECT * FROM order_items WHERE order_id = ?`, [orderId]);

        // 3. Fetch Shop Settings
        const [settings] = await db.query("SELECT * FROM shop_settings LIMIT 1");
        const rawSettings = settings.length > 0 ? settings[0] : {};

        // 4. Map DB Columns to View Variables
        // Using columns: shop_name, shop_phone, shop_address, shop_logo, pos_paper_width
        const shop = {
            store_name: rawSettings.shop_name || 'Niche Boutique',
            store_address: rawSettings.shop_address || '',
            store_phone: rawSettings.shop_phone || '',
            site_logo: rawSettings.shop_logo || null,
            pos_paper_width: rawSettings.pos_paper_width || 78 
        };

        // 5. Determine Payment Label Details
        let paymentDetail = '';
        if (order.payment_method === 'mfs' && order.bank_name) {
            paymentDetail = `To: ${order.bank_name} (${order.account_number})`;
        } else if (order.payment_method === 'bank' && order.bank_name) {
            paymentDetail = `Bank: ${order.bank_name}`;
        }

        res.render('admin/pos/receipt', {
            layout: false,
            order,
            items,
            shop,
            // FIXED: Now using 'user_id' column instead of 'name'
            cashier: req.session.user ? req.session.user.user_id : 'Staff', 
            paymentDetail
        });

    } catch (err) {
        console.error("Receipt Error:", err);
        res.status(500).send(`<pre>Error: ${err.message}</pre>`);
    }
};
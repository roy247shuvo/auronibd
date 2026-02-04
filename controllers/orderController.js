const db = require('../config/database');
const steadfast = require('../config/steadfast');

// 1. Get Web Orders Page
// 1. Get Web Orders Page (Redesign Update)
exports.getWebOrders = async (req, res) => {
    try {
        const currentStatus = req.query.status || 'confirmed';
        
        // UPDATED: Only show counts for Website orders (Exclude POS source completely)
        const [counts] = await db.query(`
            SELECT status, COUNT(*) as count 
            FROM orders 
            WHERE order_source = 'website'
            GROUP BY status
        `);
        const statusCounts = counts.reduce((acc, row) => { acc[row.status] = row.count; return acc; }, {});
        statusCounts['all'] = Object.values(statusCounts).reduce((a, b) => a + b, 0);

        // UPDATED: Base query filters by order_source = 'website'
        let query = `SELECT o.*, c.full_name, c.phone, c.address FROM orders o LEFT JOIN customers c ON o.customer_id = c.id WHERE o.order_source = 'website'`;
        const params = [];
        
        if (currentStatus !== 'all') {
            query += ` AND o.status = ?`;
            params.push(currentStatus);
        } 
        // Note: No 'else' needed because 'order_source' filter already handles the POS exclusion
        
        query += ` ORDER BY o.id DESC`;

        const [orders] = await db.query(query, params);

        if (orders.length > 0) {
            const orderIds = orders.map(o => o.id);
            // UPDATED: Added hex_code subquery for swatches
            const [items] = await db.query(`
                SELECT oi.*, 
                       (SELECT image_url 
                        FROM product_images pi 
                        WHERE pi.product_id = oi.product_id 
                        ORDER BY (pi.color_name = oi.color) DESC, sort_order ASC 
                        LIMIT 1) as image,
                       (SELECT hex_code FROM colors c WHERE c.name = oi.color LIMIT 1) as hex_code
                FROM order_items oi 
                WHERE oi.order_id IN (?)
            `, [orderIds]);

            orders.forEach(order => {
                order.items = items.filter(i => i.order_id === order.id);
                if (order.paid_amount > 0) order.final_paid = order.paid_amount;
                else {
                    if (order.payment_status === 'paid') order.final_paid = order.total_amount;
                    else if (order.payment_status === 'partial_paid') order.final_paid = order.delivery_charge;
                    else order.final_paid = 0;
                }
                order.final_due = order.total_amount - order.final_paid;
            });
        }

        res.render('admin/orders/web_orders', {
            title: 'Web Orders',
            layout: 'admin/layout',
            orders,
            currentStatus,
            statusCounts
        });
    } catch (err) { console.error(err); res.status(500).send('Server Error'); }
};

// 2. Search Products
exports.searchProducts = async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) return res.json([]);

        const [products] = await db.query(`
            SELECT pv.id as variant_id, pv.sku, pv.size, pv.color, 
                   pv.price as sale_price, pv.compare_price, pv.stock_quantity,
                   p.id as product_id, p.name as product_name,
                   (
                       SELECT image_url 
                       FROM product_images pi 
                       WHERE pi.product_id = p.id 
                       ORDER BY (pi.color_name = pv.color) DESC, pi.sort_order ASC 
                       LIMIT 1
                   ) as image
            FROM product_variants pv
            JOIN products p ON pv.product_id = p.id
            WHERE p.name LIKE ? OR pv.sku LIKE ?
            LIMIT 20
        `, [`%${query}%`, `%${query}%`]);

        res.json(products);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Search failed' });
    }
};

// 3. Check Customer
exports.checkCustomer = async (req, res) => {
    try {
        const { phone } = req.query;
        if (!phone) return res.json({ found: false });

        const [customers] = await db.query("SELECT * FROM customers WHERE phone = ?", [phone]);
        
        if (customers.length === 0) {
            return res.json({ found: false });
        }

        const customer = customers[0];

        // UPDATED: Include POS statuses in LTV Calculation
        const [stats] = await db.query(`
            SELECT COUNT(*) as total_orders, 
                   SUM(total_amount) as total_spent 
            FROM orders 
            WHERE customer_id = ? 
            AND status IN ('delivered', 'POS Complete', 'POS Partial')
        `, [customer.id]);

        res.json({
            found: true,
            customer: {
                full_name: customer.full_name,
                address: customer.address
            },
            stats: {
                count: stats[0].total_orders || 0,
                ltv: stats[0].total_spent || 0
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Check failed' });
    }
};

// 4. Create Manual Order (FIXED: Restored missing logic)
exports.createManualOrder = async (req, res) => {
    const conn = await db.getConnection(); // Use transaction for safety
    try {
        await conn.beginTransaction();

        const { phone, name, address, delivery_area, order_source, new_admin_note, cart_items, advance_payment, discount_amount, is_confirmed } = req.body;

        // 1. Parse Items & Calculate Totals
        const items = JSON.parse(cart_items);
        const shipping_rate = (delivery_area === 'inside') ? 70 : 130;
        
        let product_subtotal = 0;
        items.forEach(item => {
            product_subtotal += (parseFloat(item.price) * parseInt(item.quantity));
        });

        const discount = parseFloat(discount_amount) || 0;
        const total_amount = product_subtotal + shipping_rate - discount;
        const advance = parseFloat(advance_payment) || 0;
        
        // Determine Status based on Radio Button
        const status = (is_confirmed === 'yes') ? 'confirmed' : 'hold';

        // 2. Handle Customer (Find or Create)
        let customer_id = null;
        const [existingCust] = await conn.query("SELECT id FROM customers WHERE phone = ?", [phone]);
        
        if (existingCust.length > 0) {
            customer_id = existingCust[0].id;
            // Update address/name to latest provided
            await conn.query("UPDATE customers SET full_name = ?, address = ? WHERE id = ?", [name, address, customer_id]);
        } else {
            const [newCust] = await conn.query("INSERT INTO customers (full_name, phone, address) VALUES (?, ?, ?)", [name, phone, address]);
            customer_id = newCust.insertId;
        }

        // 3. Prepare Admin Note
        let finalNote = '';
        if (new_admin_note && new_admin_note.trim() !== '') {
            const user = req.session.user ? req.session.user.name : 'Admin';
            const time = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' });
            finalNote = `[${user} - ${time}] ${new_admin_note}`;
        }

        // 4. Handle Advance Payment (Deposit to Default Account)
        let depositAccountId = null;
        let nbTrxId = null;

        if (advance > 0) {
            const [settings] = await conn.query("SELECT bkash_deposit_account_id, last_nb_trx_sequence FROM shop_settings LIMIT 1");
            
            if (settings.length > 0) {
                depositAccountId = settings[0].bkash_deposit_account_id;
                
                // Generate NB TRX ID
                const nextTrxSeq = (settings[0].last_nb_trx_sequence || 0) + 1;
                nbTrxId = `NBTRX${String(nextTrxSeq).padStart(4, '0')}`;
                
                // Update Sequence & Deposit Money
                await conn.query("UPDATE shop_settings SET last_nb_trx_sequence = ?", [nextTrxSeq]);
                
                if (depositAccountId) {
                    await conn.query("UPDATE bank_accounts SET current_balance = current_balance + ? WHERE id = ?", [advance, depositAccountId]);
                }
            }
        }

        // --- NEW: CAPTURE GATEWAY FEE ON ADVANCE ---
        let capturedFee = 0;
        if (advance > 0 && depositAccountId) {
            const [account] = await conn.query("SELECT gateway_fee FROM bank_accounts WHERE id = ?", [depositAccountId]);
            if (account.length > 0 && account[0].gateway_fee > 0) {
                capturedFee = advance * (parseFloat(account[0].gateway_fee) / 100);
            }
        }

        // 5. Insert Order
        // We use a temporary string for order_number first, then update it with ID
        const temp_ref = 'TEMP-' + Date.now();
        
        // [UPDATED] Added gateway_fee to INSERT
        const [orderResult] = await conn.query(`
            INSERT INTO orders (order_number, nb_trx_id, bank_account_id, customer_id, guest_name, guest_phone, shipping_address, delivery_area, delivery_charge, product_subtotal, total_amount, payment_method, status, payment_status, order_source, admin_note, paid_amount, gateway_fee)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'cod', ?, 'unpaid', ?, ?, ?, ?)
        `, [temp_ref, nbTrxId, depositAccountId, customer_id, name, phone, address, delivery_area, shipping_rate, product_subtotal, total_amount, status, order_source, finalNote, advance, capturedFee]);

        const order_id = orderResult.insertId;
        const order_number = 'NB-ON' + String(order_id).padStart(5, '0');
        await conn.query("UPDATE orders SET order_number = ? WHERE id = ?", [order_number, order_id]);

        // 6. Insert Items & Deduct Stock
        for (const item of items) {
            // [STEP 2.1] Fetch current cost_price to lock it in
            const [variantInfo] = await conn.query("SELECT cost_price FROM product_variants WHERE id = ?", [item.variant_id]);
            const costPrice = (variantInfo.length > 0) ? variantInfo[0].cost_price : 0;

            // Updated INSERT to include cost_price
            await conn.query(`INSERT INTO order_items (order_id, product_id, variant_id, product_name, quantity, price, sku, size, color, cost_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
                [order_id, item.product_id, item.variant_id, item.product_name, item.quantity, item.price, item.sku, item.size, item.color, costPrice]);
            
            // [UPDATED] Deduct stock for Pending, Confirmed, or Hold
            if (['pending', 'confirmed', 'hold'].includes(status)) {
                await conn.query("UPDATE product_variants SET stock_quantity = stock_quantity - ? WHERE id = ?", [item.quantity, item.variant_id]);
                await conn.query("UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?", [item.quantity, item.product_id]);
            }
        }

        await conn.commit();
        res.redirect('/admin/orders/web-orders?success=Order Created Successfully');

    } catch (err) { 
        await conn.rollback();
        console.error("Manual Order Error:", err); 
        res.redirect('/admin/orders/web-orders?error=Failed to create order: ' + err.message); 
    } finally {
        conn.release();
    }
};

// 5. Update Order
exports.updateOrder = async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        
        // 1. Get 'new_admin_note' instead of 'admin_note'
        const { order_id, phone, name, address, delivery_area, order_source, new_admin_note, cart_items, advance_payment, discount_amount } = req.body;
        
        const items = JSON.parse(cart_items);
        const shipping_rate = (delivery_area === 'inside') ? 70 : 130;
        
        let product_subtotal = 0;
        items.forEach(item => product_subtotal += (item.price * item.quantity));
        const total_amount = product_subtotal + shipping_rate - (parseFloat(discount_amount) || 0);
        
        // Stock Logic (Unchanged)
        const [oldOrderRows] = await conn.query("SELECT status FROM orders WHERE id = ?", [order_id]);
        if (oldOrderRows.length === 0) throw new Error("Order not found");
        const currentStatus = oldOrderRows[0].status;
        // [UPDATED] Added 'pending' so stock logic works for all active orders
        const stockHoldingStatuses = ['pending', 'confirmed', 'hold', 'processing', 'RTS', 'shipped', 'Partially_Delivered'];

        if (stockHoldingStatuses.includes(currentStatus)) {
            const [oldItems] = await conn.query("SELECT variant_id, quantity FROM order_items WHERE order_id = ?", [order_id]);
            for (const item of oldItems) {
                await conn.query("UPDATE product_variants SET stock_quantity = stock_quantity + ? WHERE id = ?", [item.quantity, item.variant_id]);
            }
        }

        await conn.query("DELETE FROM order_items WHERE order_id = ?", [order_id]);

        // 2. Prepare Note Append Logic
        let noteAppend = '';
        if (new_admin_note && new_admin_note.trim() !== '') {
            const user = req.session.user ? req.session.user.name : 'Admin';
            const time = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' });
            // Add a newline before the new comment so it starts on a new line
            noteAppend = `\n[${user} - ${time}] ${new_admin_note}`;
        }

        // 3. Update Query: Use CONCAT to append the new note
        await conn.query(`
            UPDATE orders SET guest_name=?, guest_phone=?, shipping_address=?, delivery_area=?, delivery_charge=?, product_subtotal=?, total_amount=?, order_source=?, paid_amount=?,
            admin_note = CONCAT(IFNULL(admin_note, ''), ?) 
            WHERE id=?
        `, [name, phone, address, delivery_area, shipping_rate, product_subtotal, total_amount, order_source, (parseFloat(advance_payment) || 0), noteAppend, order_id]);

        for (const item of items) {
            // [STEP 2.1] Fetch current cost_price to lock it in
            const [variantInfo] = await conn.query("SELECT cost_price FROM product_variants WHERE id = ?", [item.variant_id]);
            const costPrice = (variantInfo.length > 0) ? variantInfo[0].cost_price : 0;

            // Updated INSERT to include cost_price
            await conn.query(`INSERT INTO order_items (order_id, product_id, variant_id, product_name, quantity, price, sku, size, color, cost_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
                [order_id, item.product_id, item.variant_id, item.product_name, item.quantity, item.price, item.sku, item.size, item.color, costPrice]);

            if (stockHoldingStatuses.includes(currentStatus)) {
                await conn.query("UPDATE product_variants SET stock_quantity = stock_quantity - ? WHERE id = ?", [item.quantity, item.variant_id]);
            }
        }
        await conn.commit();
        res.redirect('/admin/orders/web-orders?success=Order Updated');
    } catch (err) { await conn.rollback(); console.error(err); res.redirect('/admin/orders/web-orders?error=Failed to update order'); } finally { conn.release(); }
};

// 6. Bulk Update Status (STRICT RULES IMPLEMENTED)
exports.bulkUpdateStatus = async (req, res) => {
    try {
        const { order_ids, new_status } = req.body;
        if (!order_ids || order_ids.length === 0) return res.json({ success: false, message: 'No orders selected' });

        const placeholders = order_ids.map(() => '?').join(',');
        // Fetch ID, Status AND sent_to_courier status
        const [orders] = await db.query(`SELECT id, status, sent_to_courier FROM orders WHERE id IN (${placeholders})`, order_ids);
        
        const validIds = [];
        const idsToResetSteadfast = [];
        const idsToReturnStock = [];

        for (const order of orders) {
            const current = order.status;
            let isValid = false;
            let shouldReset = false;

            // === STRICT STATE MACHINE ===
            switch (current) {
                case 'pending':
                    // From Pending -> Hold, Confirmed, Cancelled
                    if (['hold', 'confirmed', 'cancelled'].includes(new_status)) isValid = true;
                    break;

                case 'hold':
                    // From Hold -> RTS, Cancelled
                    if (['RTS', 'cancelled'].includes(new_status)) isValid = true;
                    break;

                case 'confirmed':
                    // From Confirmed -> Hold, RTS, Cancelled
                    if (['hold', 'RTS', 'cancelled'].includes(new_status)) isValid = true;
                    break;

                case 'RTS':
                    if (new_status === 'shipped') {
                        // RTS -> Shipped: ONLY if sent to steadfast
                        if (order.sent_to_courier === 'yes') {
                            isValid = true;
                            // Do NOT reset data
                        }
                    } else if (['confirmed', 'hold', 'cancelled'].includes(new_status)) {
                        // RTS -> Backtracking: Allowed, but reset data
                        isValid = true;
                        shouldReset = true;
                    }
                    break;

                case 'shipped':
                    // From Shipped -> NO MANUAL CHANGES allowed
                    isValid = false;
                    break;

                case 'Pending_return':
                    // From Pending Return -> Returned
                    if (new_status === 'Returned') isValid = true;
                    break;
                
                default:
                    // For statuses like 'delivered', 'returned', 'cancelled' -> No changes allowed usually
                    // Unless reviving a cancelled order? Assuming blocked for now based on "strict rules"
                    isValid = false;
                    break;
            }

            // Allow staying on same status (no-op)
            if (current === new_status) isValid = true;

            if (isValid) {
                validIds.push(order.id);
                if (shouldReset) idsToResetSteadfast.push(order.id);
                
                // Inventory Logic: If moving TO Cancelled/Returned FROM a status that held stock
                const stockHeld = ['confirmed', 'hold', 'RTS', 'shipped', 'Partially_Delivered', 'Pending_return'].includes(current);
                const stockReleased = ['cancelled', 'Returned'].includes(new_status);
                
                if (stockHeld && stockReleased) {
                    idsToReturnStock.push(order.id);
                }
            }
        }

        if (validIds.length === 0) {
            return res.json({ success: false, message: 'Invalid Status Transition for selected orders.' });
        }

        // Execute Updates
        await db.query(`UPDATE orders SET status = ? WHERE id IN (?)`, [new_status, validIds]);

        // Reset Steadfast Data if backtracking from RTS
        if(idsToResetSteadfast.length > 0) {
            await db.query(`
                UPDATE orders 
                SET courier_consignment_id = NULL, 
                    courier_tracking_code = NULL, 
                    courier_status = NULL, 
                    sent_to_courier = 'no', 
                    is_label_printed = 'no' 
                WHERE id IN (?)
            `, [idsToResetSteadfast]);
        }

        // Return Stock
        if(idsToReturnStock.length > 0) {
            for (const id of idsToReturnStock) {
                const [items] = await db.query("SELECT variant_id, quantity FROM order_items WHERE order_id = ?", [id]);
                for (const item of items) {
                    await db.query("UPDATE product_variants SET stock_quantity = stock_quantity + ? WHERE id = ?", [item.quantity, item.variant_id]);
                }
            }
        }

        res.json({ success: true, updated: validIds.length });
    } catch (err) { 
        console.error(err); 
        res.status(500).json({ success: false, message: err.message }); 
    }
};

// 7. Update Status (Single - Redirects to Bulk)
exports.updateStatus = async (req, res) => {
    req.body.order_ids = [req.body.order_id];
    req.body.new_status = req.body.status;
    return exports.bulkUpdateStatus(req, res);
};

// 8. Send to Steadfast (Final Fix)
exports.sendToSteadfast = async (req, res) => {
    try {
        const { order_ids } = req.body;
        const [orders] = await db.query(`
            SELECT o.*, c.full_name, c.phone, c.address 
            FROM orders o LEFT JOIN customers c ON o.customer_id = c.id
            WHERE o.id IN (?) AND o.status = 'RTS' AND o.sent_to_courier = 'no'
        `, [order_ids]);

        if (orders.length === 0) return res.json({ success: false, message: 'Only RTS orders (not sent yet) can be sent.' });

        const steadfastPayload = orders.map(o => {
            const total = parseFloat(o.total_amount) || 0;
            const paid = parseFloat(o.paid_amount) || 0;
            const due = Math.max(0, total - paid);
            
            // Sanitization
            let cleanPhone = (o.guest_phone || '').replace(/[^0-9]/g, '');
            if(cleanPhone.length > 11) cleanPhone = cleanPhone.slice(-11);
            
            const cleanAddress = (o.shipping_address || '').substring(0, 245);

            return {
                invoice: o.order_number, 
                recipient_name: o.guest_name,
                recipient_phone: cleanPhone,
                recipient_address: cleanAddress,
                cod_amount: parseInt(due), 
                note: `Order #${o.order_number}`
            };
        });

        // Call API
        const result = await steadfast.bulkCreate(steadfastPayload);
        
        console.log("Steadfast API Result:", JSON.stringify(result, null, 2));

        // 1. Check for Top-Level Status Error
        if (result.status && result.status !== 'success' && result.status !== 200) {
             // Handle "We have a response for you" by looking for nested errors
             if (result.errors) {
                 const details = Object.values(result.errors).flat().join(', ');
                 return res.json({ success: false, message: `Validation Error: ${details}` });
             }
             return res.json({ success: false, message: `Courier Error: ${result.message || 'Unknown Error'}` });
        }

        // 2. Parse Order List
        let orderList = [];
        if (Array.isArray(result)) orderList = result;
        else if (result.data && Array.isArray(result.data)) orderList = result.data;
        else if (result.consignment) orderList = [result.consignment];

        // 3. Update Database
        let successCount = 0;
        let errors = [];

        if (orderList.length > 0) {
            for (const resOrder of orderList) {
                // Check if this specific item succeeded
                if (resOrder.status === 'success' || (resOrder.consignment_id && resOrder.tracking_code)) {
                    await db.query(`
                        UPDATE orders 
                        SET sent_to_courier = 'yes', 
                            courier_consignment_id = ?, 
                            courier_tracking_code = ? 
                        WHERE order_number = ?
                    `, [resOrder.consignment_id, resOrder.tracking_code, resOrder.invoice]);
                    successCount++;
                } else {
                    const failReason = resOrder.message || resOrder.status || 'Failed';
                    errors.push(`${resOrder.invoice}: ${failReason}`);
                }
            }
        }
        
        if (successCount > 0) {
            res.json({ success: true, message: `Successfully sent ${successCount} orders.` });
        } else {
            const finalMsg = errors.length > 0 ? errors.join(', ') : (result.message || "No valid response data");
            res.json({ success: false, message: `Failed: ${finalMsg}` });
        }

    } catch (err) { 
        console.error("Controller Error:", err.message); 
        res.json({ success: false, message: `System Error: ${err.message}` }); 
    }
};

// 9. Print Labels (Updated for Product Details)
exports.printLabels = async (req, res) => {
    try {
        const { order_ids, size } = req.query; 
        const ids = order_ids.split(',');
        
        // 1. Fetch Orders
        const [orders] = await db.query(`SELECT * FROM orders WHERE id IN (?) AND sent_to_courier = 'yes'`, [ids]);
        if(orders.length === 0) return res.send("Orders must be sent to courier first.");
        
        // 2. Fetch Items (Added size & color)
        const [items] = await db.query(`
            SELECT oi.order_id, oi.sku, oi.quantity, oi.product_name, oi.price, oi.size, oi.color, pv.compare_price 
            FROM order_items oi 
            LEFT JOIN product_variants pv ON oi.variant_id = pv.id 
            WHERE oi.order_id IN (?)
        `, [ids]);

        // 3. Attach items to orders
        orders.forEach(order => {
            order.items = items.filter(i => i.order_id === order.id);
        });

        // 4. Fetch Shop Settings
        const [shop] = await db.query(`SELECT * FROM shop_settings LIMIT 1`);
        
        // 5. Mark as Printed
        const validIds = orders.map(o => o.id);
        await db.query(`UPDATE orders SET is_label_printed = 'yes' WHERE id IN (?)`, [validIds]);

        res.render('admin/orders/print_labels', { layout: false, orders, size: size || '3x4', shop: shop[0] });
    } catch (err) { console.error(err); res.send("Error"); }
};

/// 10. Webhook Handler (Upgraded for Timeline & Rider Extraction)
exports.handleWebhook = async (req, res) => {
    try {
        const { notification_type, consignment_id, invoice, status, tracking_message, updated_at } = req.body;
        
        console.log("Webhook received:", req.body); // Debug log

        // 1. Find the Order in Your DB
        // We use 'invoice' because that maps to your 'order_number'
        const [orders] = await db.query("SELECT id FROM orders WHERE order_number = ?", [invoice]);
        
        if (orders.length === 0) {
            return res.status(404).json({ status: "error", message: "Order not found" });
        }
        const orderId = orders[0].id;

        // 2. PARSE RIDER DETAILS (The Magic Part)
        // Example Msg: "Assigned by rider-Md Sajol Islam-01404556689"
        let riderName = null;
        let riderPhone = null;

        if (tracking_message && tracking_message.includes('Assigned by rider')) {
            // Split by dash usually used by Steadfast
            const parts = tracking_message.split('-'); 
            // parts[0] = "Assigned by rider"
            // parts[1] = "Md Sajol Islam" (Name)
            // parts[2] = "01404556689" (Phone)
            
            if (parts.length >= 3) {
                riderName = parts[1].trim();
                riderPhone = parts[2].trim();
            }
        }

        // 3. Insert into Timeline History
        // We save EVERYTHING (Message, Time, Rider Info)
        await db.query(`
            INSERT INTO order_timelines 
            (order_id, consignment_id, status, message, rider_name, rider_phone, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [orderId, consignment_id, status || 'info', tracking_message, riderName, riderPhone, updated_at]);

        // 4. Update Main Order Status (If it's a major status change)
        // Only update main status if notification_type is 'delivery_status'
        if (notification_type === 'delivery_status') {
            let dbStatus = null;
            if (status === 'delivered') dbStatus = 'delivered';
            else if (status === 'partial_delivered') dbStatus = 'Partially_Delivered';
            else if (status === 'cancelled') dbStatus = 'Pending_return'; 
            
            if (dbStatus) {
                await db.query(`
                    UPDATE orders 
                    SET status = ?, courier_status = ? 
                    WHERE id = ?
                `, [dbStatus, status, orderId]);
            }
        } 

        res.status(200).json({ status: "success" });

    } catch (err) {
        console.error("Webhook Error:", err);
        res.status(500).json({ status: "error" });
    }
};

// 11. Label Settings Page
exports.getLabelSettings = async (req, res) => {
    res.render('admin/orders/label_settings', { title: 'Label Settings', layout: 'admin/layout' });
};

// 12. Backup Poller: Sync Status (Called by Server Interval)
exports.syncSteadfastStatus = async () => {
    try {
        console.log(`[${new Date().toLocaleString()}] 🔄 Starting Steadfast Sync...`);
        
        // 1. Find orders that are "Active" with courier
        // We exclude final states like delivered, returned, or cancelled to save API calls
        const [orders] = await db.query(`
            SELECT id, order_number, courier_consignment_id, status 
            FROM orders 
            WHERE sent_to_courier = 'yes' 
            AND courier_consignment_id IS NOT NULL
            AND status NOT IN ('delivered', 'Returned', 'cancelled', 'Partially_Delivered', 'Pending_return')
        `);

        if(orders.length === 0) return console.log("No active courier orders to sync.");

        for (const order of orders) {
            // 2. Call API for each order
            const data = await steadfast.checkStatus(order.courier_consignment_id);
            
            // 3. Update if status changed
            if (data && data.delivery_status) {
                const apiStatus = data.delivery_status; // e.g. 'delivered'
                let dbStatus = null;

                // Map Steadfast Status to Our DB Status
                if (apiStatus === 'delivered') dbStatus = 'delivered';
                else if (apiStatus === 'partial_delivered') dbStatus = 'Partially_Delivered';
                else if (apiStatus === 'cancelled') dbStatus = 'Pending_return';
                
                // Only update if we have a valid mapping AND it's different from current
                if (dbStatus && dbStatus !== order.status) {
                    await db.query("UPDATE orders SET status = ?, courier_status = ? WHERE id = ?", [dbStatus, apiStatus, order.id]);
                    console.log(`✔ Synced ${order.order_number}: ${order.status} -> ${dbStatus}`);
                }
            }
        }
    } catch (err) {
        console.error("Steadfast Sync Error:", err.message);
    }
};
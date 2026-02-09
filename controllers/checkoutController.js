const db = require('../config/database');
const bkashService = require('../config/bkashService'); 
const metaService = require('../config/metaService'); //

// Helper: Get Cart
const getSessionCart = (req) => { return req.session.cart || []; };

// 1. GET CART API (FIXED: Added lineTotal & originalPrice)
exports.getCartAPI = async (req, res) => {
    try {
        let cartSession = getSessionCart(req);
        if (cartSession.length === 0) return res.json({ items: [], subtotal: 0, count: 0, totalSavings: 0 });

        const variantIds = cartSession.map(item => item.variantId);
        const [variants] = await db.query(`
            SELECT pv.*, p.name as product_name, p.slug, p.regular_price, p.sale_price,
            (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY (pi.color_name = pv.color) DESC, sort_order ASC LIMIT 1) as image
            FROM product_variants pv JOIN products p ON pv.product_id = p.id WHERE pv.id IN (?)
        `, [variantIds]);

        let subtotal = 0;
        let totalSavings = 0;

        const detailedCart = cartSession.map(item => {
            const dbItem = variants.find(v => v.id == item.variantId);
            if (!dbItem) return null;
            
            // 1. Determine Prices
            let highPrice = Number(dbItem.price || dbItem.regular_price); // Old Price
            let lowPrice = Number(dbItem.compare_price || dbItem.sale_price); // Sale Price
            
            // If sale price exists and is lower, use it. Otherwise use high price.
            let finalPrice = (lowPrice > 0 && lowPrice < highPrice) ? lowPrice : highPrice;
            
            // 2. Calculate Line Totals
            const quantity = parseInt(item.quantity);
            const lineTotal = finalPrice * quantity;
            const savings = (highPrice - finalPrice) * quantity;

            subtotal += lineTotal;
            if (savings > 0) totalSavings += savings;

            // 3. Return Complete Object
            return { 
                ...item, 
                ...dbItem, 
                price: finalPrice,          // Selling Price
                originalPrice: highPrice,   // For Strike-through
                lineTotal: lineTotal        // For "TK. 500" display
            };
        }).filter(i => i);

        res.json({ 
            items: detailedCart, 
            subtotal, 
            totalSavings,
            count: detailedCart.length 
        });
    } catch (err) { 
        console.error(err); 
        res.status(500).json({ error: "An internal error occurred while processing your cart." }); 
    }
};

// 2. ADD TO CART (With Meta CAPI)
exports.addToCart = async (req, res) => {
    try {
        const { variantId, quantity } = req.body;
        if (!variantId || isNaN(parseInt(variantId))) return res.json({ success: false, message: "Invalid ID" });

        if (!req.session.cart) req.session.cart = [];

        // Add to Session
        const existing = req.session.cart.find(i => i.variantId == variantId);
        if (existing) {
            existing.quantity += parseInt(quantity || 1);
        } else {
            req.session.cart.push({ variantId: parseInt(variantId), quantity: parseInt(quantity || 1) });
        }
        
        // --- META SERVER-SIDE ADD TO CART ---
        // Fetch price/name for the event value
        const [variants] = await db.query("SELECT p.name, p.sale_price, p.regular_price FROM product_variants pv JOIN products p ON pv.product_id = p.id WHERE pv.id = ?", [variantId]);
        
        if (variants.length > 0) {
            const prod = variants[0];
            const price = Number(prod.sale_price > 0 ? prod.sale_price : prod.regular_price);
            
            metaService.sendEvent('AddToCart', {
                custom_data: {
                    content_ids: [variantId],
                    content_type: 'product',
                    content_name: prod.name,
                    value: price * (parseInt(quantity) || 1),
                    currency: 'BDT'
                }
            }, req);
        }
        // ------------------------------------

        req.session.save(err => {
            if(err) return res.json({ success: false });
            res.json({ success: true, count: req.session.cart.length });
        });
    } catch (err) {
        console.error("Add Cart Error:", err);
        res.json({ success: false });
    }
};

// 3. UPDATE QUANTITY
exports.updateCartItem = (req, res) => {
    const { variantId, action } = req.body;
    if (!req.session.cart) return res.json({ success: false });

    const item = req.session.cart.find(i => i.variantId == variantId);
    if (item) {
        if (action === 'increase') item.quantity++;
        if (action === 'decrease') item.quantity--;
        if (item.quantity <= 0) {
            req.session.cart = req.session.cart.filter(i => i.variantId != variantId);
        }
    }

    req.session.save(err => {
        if(err) return res.json({ success: false });
        res.json({ success: true });
    });
};

// 4. REMOVE ITEM
exports.removeCartItem = (req, res) => {
    const { variantId } = req.body;
    if (req.session.cart) {
        req.session.cart = req.session.cart.filter(i => i.variantId != variantId);
    }
    req.session.save(err => {
        if(err) return res.json({ success: false });
        res.json({ success: true });
    });
};

// 5. GET CHECKOUT PAGE
exports.getCheckout = async (req, res) => {
    try {
        const cartSession = getSessionCart(req);
        if (cartSession.length === 0) return res.redirect('/shop');

        const variantIds = cartSession.map(item => item.variantId);
        
        // FIX: Prioritize image matching the variant color
        const [variants] = await db.query(`
            SELECT pv.*, p.name as product_name, p.regular_price, p.sale_price, p.is_preorder, 
            (SELECT image_url FROM product_images pi 
             WHERE pi.product_id = p.id 
             ORDER BY (pi.color_name = pv.color) DESC, sort_order ASC 
             LIMIT 1) as image 
            FROM product_variants pv 
            JOIN products p ON pv.product_id = p.id 
            WHERE pv.id IN (?)
        `, [variantIds]);
        
        let subtotal = 0;
        const cartItems = cartSession.map(item => {
            const dbItem = variants.find(v => v.id == item.variantId);
            if(!dbItem) return null;
            
            let highPrice = Number(dbItem.price || dbItem.regular_price);
            let lowPrice = Number(dbItem.compare_price || dbItem.sale_price);
            let price = (lowPrice > 0 && lowPrice < highPrice) ? lowPrice : highPrice;
            
            subtotal += price * item.quantity;
            return { ...item, ...dbItem, price, name: dbItem.product_name };
        }).filter(i => i);

        const [settings] = await db.query("SELECT * FROM shop_settings WHERE id = 1");
        const [categories] = await db.query("SELECT * FROM categories"); 
        const [brands] = await db.query("SELECT * FROM brands");
        const [colors] = await db.query("SELECT * FROM colors");
        const [collections] = await db.query("SELECT * FROM collections");

        // [NEW] Track InitiateCheckout (Server Side)
        if (cartSession.length > 0) {
            metaService.sendEvent('InitiateCheckout', {
                custom_data: {
                    num_items: cartSession.length,
                    value: subtotal,
                    currency: 'BDT'
                }
            }, req);
        }

        // Check if ANY item in cart is a preorder item
        const isPreOrder = cartItems.some(item => item.is_preorder === 'yes');

        res.render('shop/pages/checkout', {
            title: 'Checkout',
            layout: 'shop/layout',
            cartItems,
            subtotal,
            isPreOrder, // <--- Pass Flag
            settings: settings[0],
            categories, brands, colors, collections
        });

    } catch (err) { console.error(err); res.status(500).send("Error loading checkout"); }
};


// NEW: Capture Incomplete Order (Abandoned Cart)
exports.captureIncomplete = async (req, res) => {
    try {
        let { phone, full_name, address } = req.body;
        const cartSession = getSessionCart(req);

        // 1. Basic Validation
        if (!phone || cartSession.length === 0) return res.json({ success: false });
        
        let cleanPhone = phone.replace(/\D/g, '');
        if (!/^01\d{9}$/.test(cleanPhone)) return res.json({ success: false }); // Strict 11 digit check

        // 2. Check for Existing Orders (The Conditions)
        // Condition 1: If they have an active order, IGNORE.
        const [existingActive] = await db.query(`
            SELECT id FROM orders 
            WHERE guest_phone = ? 
            AND status IN ('pending', 'hold', 'confirmed', 'RTS', 'shipped') 
            LIMIT 1
        `, [cleanPhone]);

        if (existingActive.length > 0) return res.json({ success: false, message: "Active order exists" });

        // 3. Prepare Data
        const [settings] = await db.query("SELECT * FROM shop_settings WHERE id = 1");
        // Default to Inside Dhaka if unknown
        const delivery_charge = settings[0].delivery_inside_dhaka; 
        
        // Calculate Totals
        const variantIds = cartSession.map(item => item.variantId);
        // [AFTER] (Fetch is_preorder)
        const [variants] = await db.query(`SELECT pv.*, p.name, p.regular_price, p.sale_price, p.is_preorder FROM product_variants pv JOIN products p ON pv.product_id = p.id WHERE pv.id IN (?)`, [variantIds]);
        
        // Detect PreOrder
        const isPreOrderOrder = variants.some(v => v.is_preorder === 'yes');
        
        let product_subtotal = 0;
        const orderItemsData = [];
        
        cartSession.forEach(item => {
            const dbItem = variants.find(v => v.id == item.variantId);
            if (dbItem) {
                let price = (dbItem.compare_price > 0 && dbItem.compare_price < dbItem.price) ? dbItem.compare_price : (dbItem.price || dbItem.regular_price);
                product_subtotal += price * item.quantity;
                // Prepare item for insertion (Placeholder order_id = null)
                orderItemsData.push([ null, dbItem.product_id, dbItem.id, dbItem.name, dbItem.sku, dbItem.color, dbItem.size, price, item.quantity, price * item.quantity ]);
            }
        });

        const total_amount = product_subtotal + Number(delivery_charge);

        // 4. Check for EXISTING INCOMPLETE order
        const [existingIncomplete] = await db.query(`SELECT id FROM orders WHERE guest_phone = ? AND status = 'incomplete' LIMIT 1`, [cleanPhone]);

        let order_id;

        if (existingIncomplete.length > 0) {
            // UPDATE existing incomplete order
            order_id = existingIncomplete[0].id;
            
            await db.query(`
                UPDATE orders SET 
                guest_name = ?, shipping_address = ?, product_subtotal = ?, total_amount = ?, created_at = NOW()
                WHERE id = ?
            `, [full_name || 'Guest', address || 'Not Provided', product_subtotal, total_amount, order_id]);
            
            // Re-insert items (Clear old ones first)
            await db.query("DELETE FROM order_items WHERE order_id = ?", [order_id]);
            
        } else {
            // INSERT new incomplete order
            const [result] = await db.query(`
                INSERT INTO orders 
                (order_number, guest_name, guest_phone, shipping_address, delivery_area, delivery_charge, product_subtotal, total_amount, payment_method, status, payment_status)
                VALUES (?, ?, ?, ?, 'inside', ?, ?, ?, 'cod', 'incomplete', 'unpaid')
            `, ['TEMP', full_name || 'Guest', cleanPhone, address || 'Not Provided', delivery_charge, product_subtotal, total_amount]);
            
            order_id = result.insertId;
            // Set ID as INC-00001
            const inc_number = 'INC-' + String(order_id).padStart(5, '0');
            await db.query("UPDATE orders SET order_number = ? WHERE id = ?", [inc_number, order_id]);
        }

        // Insert Items
        const finalItems = orderItemsData.map(item => { item[0] = order_id; return item; });
        if (finalItems.length > 0) await db.query(`INSERT INTO order_items (order_id, product_id, variant_id, product_name, sku, color, size, price, quantity, line_total) VALUES ?`, [finalItems]);

        res.json({ success: true });

    } catch (err) {
        console.error("Incomplete Capture Error:", err);
        res.json({ success: false });
    }
};

// 6. PROCESS ORDER (Updated for Incomplete Conversion)
exports.placeOrder = async (req, res) => {
    try {
        let { full_name, phone, address, delivery_area, payment_method } = req.body;
        const cartSession = getSessionCart(req);

        if (cartSession.length === 0) return res.redirect('/shop');

        // --- VALIDATION START ---
        if (!address || address.length > 250) return res.send("Address is too long.");
        
        let cleanPhone = phone.replace(/\D/g, ''); 
        if (cleanPhone.startsWith('8801')) cleanPhone = cleanPhone.substring(2);
        else if (cleanPhone.startsWith('1') && cleanPhone.length === 10) cleanPhone = '0' + cleanPhone;

        const bdPhoneRegex = /^01\d{9}$/;
        if (!bdPhoneRegex.test(cleanPhone)) return res.send("Invalid Phone Number.");
        phone = cleanPhone;
        // --- VALIDATION END ---

        // === NEW: FINAL STOCK CHECK ===
        const variantIdsCheck = cartSession.map(item => item.variantId);
        if (variantIdsCheck.length > 0) {
            // [FIX] Fetch 'is_preorder' to bypass checks
            const [stockCheck] = await db.query(
                `SELECT pv.id, pv.stock_quantity, p.name, p.is_preorder
                 FROM product_variants pv 
                 JOIN products p ON pv.product_id = p.id
                 WHERE pv.id IN (?)`, 
                [variantIdsCheck]
            );

            for (const item of cartSession) {
                const dbVariant = stockCheck.find(v => v.id == item.variantId);
                
                // Condition 1: Variant doesn't exist anymore
                if (!dbVariant) {
                    return res.send(`Sorry, one of the items in your cart is no longer available.`);
                }

                // Condition 2: Not enough stock (SKIP IF PRE-ORDER)
                if (dbVariant.is_preorder !== 'yes' && dbVariant.stock_quantity < item.quantity) {
                    // Custom "You Missed It" Screen
                    return res.send(`
                        <div style="height:100vh; display:flex; flex-direction:column; justify-content:center; align-items:center; font-family:sans-serif; text-align:center; background:#fff;">
                            <div style="font-size:100px; animation: sadBounce 2s infinite; margin-bottom: 20px;">😢</div>
                            <h2 style="font-size:24px; font-weight:bold; color:#1f2937; margin:0;">Oh no!</h2>
                            <p style="font-size:18px; color:#4b5563; margin-top:10px;">Someone bought this 28 sec ago. You just missed it.</p>
                            <a href="/cart" style="margin-top:30px; padding:12px 25px; background:#000; color:#fff; text-decoration:none; border-radius:5px; font-weight:bold; text-transform:uppercase; letter-spacing:1px;">Return to Cart</a>
                            <style>@keyframes sadBounce { 0%, 20%, 50%, 80%, 100% {transform: translateY(0);} 40% {transform: translateY(-20px);} 60% {transform: translateY(-10px);} }</style>
                        </div>
                    `);
                }
            }
        }

        // 1. Calc Totals
        const [settings] = await db.query("SELECT * FROM shop_settings WHERE id = 1");
        const rate = delivery_area === 'inside' ? settings[0].delivery_inside_dhaka : settings[0].delivery_outside_dhaka;
        const advanceRequired = settings[0].checkout_advance_delivery === 'yes';

        const variantIds = cartSession.map(item => item.variantId);
        // [UPDATED] Fetch is_preorder column
        const [variants] = await db.query(`SELECT pv.*, p.name, p.regular_price, p.sale_price, p.is_preorder FROM product_variants pv JOIN products p ON pv.product_id = p.id WHERE pv.id IN (?)`, [variantIds]);
        
        // [NEW] Detect if this is a Pre-Order
        const isPreOrderOrder = variants.some(v => v.is_preorder === 'yes');

        let product_subtotal = 0;
        const orderItemsData = [];
        const stockUpdates = [];

        cartSession.forEach(item => {
            const dbItem = variants.find(v => v.id == item.variantId);
            if (dbItem) {
                let price = (dbItem.compare_price > 0 && dbItem.compare_price < dbItem.price) ? dbItem.compare_price : (dbItem.price || dbItem.regular_price);
                product_subtotal += price * item.quantity;
                orderItemsData.push([ null, dbItem.product_id, dbItem.id, dbItem.name, dbItem.sku, dbItem.color, dbItem.size, price, item.quantity, price * item.quantity ]);
                stockUpdates.push({ id: dbItem.id, qty: item.quantity });
            }
        });

        const total_amount = product_subtotal + Number(rate);
        
        // 2. Customer Setup
        let customer_id = null;
        const [existingCust] = await db.query("SELECT id FROM customers WHERE phone = ?", [phone]);
        if (existingCust.length > 0) customer_id = existingCust[0].id;
        else {
            const [newCust] = await db.query("INSERT INTO customers (full_name, phone, address) VALUES (?, ?, ?)", [full_name, phone, address]);
            customer_id = newCust.insertId;
        }

        // Determine initial status
        let initialStatus = 'pending';
        if (isPreOrderOrder) {
            initialStatus = 'pre_order'; // Force Pre-Order Status
        } else if (payment_method === 'cod') {
            initialStatus = advanceRequired ? 'hold' : 'pending';
        }

        // --- NEW LOGIC: Check for Incomplete Order to Convert ---
        const [incompleteOrder] = await db.query(`SELECT id FROM orders WHERE guest_phone = ? AND status = 'incomplete' LIMIT 1`, [phone]);
        
        let order_id;
        
        if (incompleteOrder.length > 0) {
            // CONVERT existing incomplete order
            order_id = incompleteOrder[0].id;
            
            // --- NEW: Generate NB TRX ID Logic ---
            let nbTrxId = 'Not Available';
            if (payment_method !== 'cod') {
                const [settings] = await db.query("SELECT last_nb_trx_sequence FROM shop_settings LIMIT 1");
                const nextSeq = (settings[0].last_nb_trx_sequence || 0) + 1;
                nbTrxId = `NBTRX${String(nextSeq).padStart(4, '0')}`;
                await db.query("UPDATE shop_settings SET last_nb_trx_sequence = ?", [nextSeq]);
            }
            // -------------------------------------

            await db.query(`
                UPDATE orders SET 
                nb_trx_id = ?, customer_id = ?, guest_name = ?, shipping_address = ?, 
                delivery_area = ?, delivery_charge = ?, product_subtotal = ?, total_amount = ?, 
                payment_method = ?, status = ?, payment_status = 'unpaid', created_at = NOW()
                WHERE id = ?
            `, [nbTrxId, customer_id, full_name, address, delivery_area, rate, product_subtotal, total_amount, payment_method, initialStatus, order_id]);

            // Clear old items to re-insert confirmed ones
            await db.query("DELETE FROM order_items WHERE order_id = ?", [order_id]);

        } else {
            // CREATE new order (Standard flow)
            const temp_ref = 'TEMP-' + Date.now();
            
            // --- NEW: Generate NB TRX ID Logic ---
            let nbTrxId = 'Not Available'; // Default for COD
            
            if (payment_method !== 'cod') {
                const [settings] = await db.query("SELECT last_nb_trx_sequence FROM shop_settings LIMIT 1");
                const nextSeq = (settings[0].last_nb_trx_sequence || 0) + 1;
                nbTrxId = `NBTRX${String(nextSeq).padStart(4, '0')}`;
                await db.query("UPDATE shop_settings SET last_nb_trx_sequence = ?", [nextSeq]);
            }
            // -------------------------------------

            const [orderResult] = await db.query(`
                INSERT INTO orders 
                (order_number, nb_trx_id, customer_id, guest_name, guest_phone, shipping_address, delivery_area, delivery_charge, product_subtotal, total_amount, payment_method, status, payment_status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid')
            `, [temp_ref, nbTrxId, customer_id, full_name, phone, address, delivery_area, rate, product_subtotal, total_amount, payment_method, initialStatus]);
            order_id = orderResult.insertId;
        }

        // [NEW] Generate Permanent Order Number (AR-00013 Start)
        // We use 'last_trx_sequence' from settings so it continues even if you delete orders
        const [seqSettings] = await db.query("SELECT last_trx_sequence FROM shop_settings LIMIT 1");
        let lastSeq = seqSettings[0].last_trx_sequence || 0;

        // Logic: If counter is 0 or low, force it to start at 12 (so next is 13)
        if (lastSeq < 12) lastSeq = 12; 
        const nextSeq = lastSeq + 1;

        const order_number = 'AR-' + String(nextSeq).padStart(5, '0');

        // Update the counter and the order
        await db.query("UPDATE shop_settings SET last_trx_sequence = ?", [nextSeq]);
        await db.query("UPDATE orders SET order_number = ? WHERE id = ?", [order_number, order_id]);

        // Insert Items
        const finalItems = orderItemsData.map(item => { item[0] = order_id; return item; });
        if (finalItems.length > 0) await db.query(`INSERT INTO order_items (order_id, product_id, variant_id, product_name, sku, color, size, price, quantity, line_total) VALUES ?`, [finalItems]);
        
        // Stock Update (Variants + Batches)
        for (const update of stockUpdates) {
            // 1. Deduct from Variant (Existing)
            await db.query(`UPDATE product_variants SET stock_quantity = stock_quantity - ? WHERE id = ?`, [update.qty, update.id]);
        
            // 2. Deduct from Batches (FIFO Logic) - [NEW]
            let qtyToDeduct = update.qty;
            
            // Get batches for this variant, ordered by creation (Oldest First)
            const [batches] = await db.query(`
                SELECT id, remaining_quantity 
                FROM inventory_batches 
                WHERE variant_id = ? AND remaining_quantity > 0 
                ORDER BY created_at ASC
            `, [update.id]);
        
            for (const batch of batches) {
                if (qtyToDeduct <= 0) break; // Done
        
                const take = Math.min(qtyToDeduct, batch.remaining_quantity);
                
                await db.query(`UPDATE inventory_batches SET remaining_quantity = remaining_quantity - ? WHERE id = ?`, [take, batch.id]);
                
                qtyToDeduct -= take;
            }
        }

        // [NEW] Track Purchase (Server Side - High Quality)
        // We use the Order Number as the Event ID to deduplicate if you add Browser Pixel later
        metaService.sendEvent('Purchase', {
            event_id: order_number, 
            email: null, 
            phone: phone, // Pass raw phone, MetaService will hash it
            first_name: full_name, // Pass raw name, MetaService will hash it
            custom_data: {
                content_ids: orderItemsData.map(i => i[1]), 
                content_type: 'product',
                value: total_amount,
                currency: 'BDT',
                order_id: order_number,
                num_items: finalItems.length
            }
        }, req);

        // 3. Payment Redirect Logic
        
        // [NEW] BYPASS FOR PRE-ORDER
        if (isPreOrderOrder) {
            req.session.allowed_order = order_number;
            return req.session.save(() => res.redirect('/order-confirmation/' + order_number));
        }

        // Standard Logic
        let amountToPay = 0;
        if (payment_method === 'bkash') amountToPay = total_amount;
        else if (payment_method === 'cod' && advanceRequired) amountToPay = Number(rate);

        if (payment_method === 'cod' && !advanceRequired) {
            req.session.allowed_order = order_number;
            return req.session.save(() => res.redirect('/order-confirmation/' + order_number));
        }

        // bKash Init
        const token = await bkashService.grantToken();
        const paymentData = {
            mode: '0011',
            payerReference: phone,
            callbackURL: `${process.env.APP_URL}/bkash/callback?order_number=${order_number}`, 
            amount: amountToPay.toFixed(2),
            currency: 'BDT',
            intent: 'sale',
            merchantInvoiceNumber: order_number
        };

        const bkashResponse = await bkashService.createPayment(token, paymentData);
        if (bkashResponse && bkashResponse.bkashURL) return res.redirect(bkashResponse.bkashURL);
        else return res.send("Payment Initialization Failed.");

    } catch (err) {
        console.error(err);
        res.status(500).send("Order Failed: " + err.message);
    }
};

// 7. CONFIRMATION (Secured & Detailed)
exports.orderConfirmation = async (req, res) => {
    try {
        const order_number = req.params.order_number;

        // --- SECURITY CHECK ---
        // 1. Check if the user has the "pass" in their session
        if (!req.session.allowed_order || req.session.allowed_order !== order_number) {
            // If they don't match, kick them to the home page
            return res.redirect('/'); 
        }
        // ----------------------

        // 2. Fetch Order Details (Fixes 'order is not defined' error)
        const [orders] = await db.query(`
            SELECT o.*, 
                   c.full_name, c.phone, c.address 
            FROM orders o
            LEFT JOIN customers c ON o.customer_id = c.id
            WHERE o.order_number = ?
        `, [order_number]);

        if (orders.length === 0) return res.redirect('/');
        const order = orders[0];

        // 3. Fetch Order Items with Images
        const [items] = await db.query(`
            SELECT oi.*, 
                   (SELECT image_url FROM product_images pi WHERE pi.product_id = oi.product_id ORDER BY sort_order ASC LIMIT 1) as image
            FROM order_items oi 
            WHERE oi.order_id = ?
        `, [order.id]);

        // 4. Global Data (for Header/Footer)
        const [categories] = await db.query("SELECT * FROM categories");
        const [brands] = await db.query("SELECT * FROM brands");
        const [colors] = await db.query("SELECT * FROM colors");
        const [collections] = await db.query("SELECT * FROM collections");

        res.render('shop/pages/order_confirmation', { 
            title: 'Order Confirmed', 
            layout: 'shop/layout',
            order,
            items,
            categories, brands, colors, collections
        });
        
    } catch (err) { 
        console.error(err); 
        res.status(500).send("Error loading confirmation"); 
    }
};
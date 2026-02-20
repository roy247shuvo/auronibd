const db = require('../config/database');

exports.getAccount = async (req, res) => {
    try {
        if (!req.session.customer) return res.redirect('/');

        const customerId = req.session.customer.id;

        // 1. Fetch Customer Details (Fresh Data)
        const [cust] = await db.query("SELECT * FROM customers WHERE id = ?", [customerId]);
        const customer = cust[0];

        // 2. Fetch Orders
        const [orders] = await db.query(`
            SELECT * FROM orders 
            WHERE customer_id = ? 
            ORDER BY created_at DESC
        `, [customerId]);

        // 3. Fetch Items for Preview Images
        if (orders.length > 0) {
            const orderIds = orders.map(o => o.id);
            const [items] = await db.query(`
                SELECT oi.*, 
                (SELECT image_url FROM product_images pi WHERE pi.product_id = oi.product_id ORDER BY sort_order ASC LIMIT 1) as image
                FROM order_items oi 
                WHERE oi.order_id IN (?)
            `, [orderIds]);

            orders.forEach(order => {
                order.items = items.filter(i => i.order_id === order.id);
            });
        }

        // 4. Calculate Customer Level
        let totalSpent = 0;
        const validStatuses = ['delivered', 'pos complete', 'pos partial'];
        
        orders.forEach(o => {
            if (validStatuses.includes((o.status || '').toLowerCase())) {
                totalSpent += parseFloat(o.total_amount || 0);
            }
        });

        let level = 'Bronze';
        if (totalSpent >= 100000) level = 'VIP';
        else if (totalSpent >= 50000) level = 'Platinum';
        else if (totalSpent >= 20000) level = 'Gold';
        else if (totalSpent >= 5000) level = 'Silver';

        // 5. Global Data (Required for Header/Footer)
        const [categories] = await db.query("SELECT * FROM categories");
        const [brands] = await db.query("SELECT * FROM brands");
        const [collections] = await db.query("SELECT * FROM collections");
        const [colors] = await db.query("SELECT * FROM colors"); // [FIXED] Added Colors
        const [settings] = await db.query("SELECT * FROM shop_settings LIMIT 1");

        res.render('shop/pages/account', {
            title: 'My Account',
            layout: 'shop/layout',
            customer: customer, 
            orders,
            level,
            totalSpent,
            categories, brands, collections, colors, // [FIXED] Passed Colors
            shopSettings: settings[0],
            success: req.query.success,
            error: req.query.error
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Server Error");
    }
};

// --- Update Profile Function ---
exports.updateProfile = async (req, res) => {
    try {
        if (!req.session.customer) return res.redirect('/');

        // In exports.updateProfile
        const { full_name, phone, address } = req.body;
        const customerId = req.session.customer.id;

        // 1. Fetch Current Data to check if phone changed
        const [current] = await db.query("SELECT phone, alt_phone FROM customers WHERE id = ?", [customerId]);
        const oldPhone = current[0].phone;
        let altPhone = current[0].alt_phone;

        // 2. Logic: If phone changed, save the old one to history
        if (phone !== oldPhone) {
            // If alt_phone is empty, start it. If exists, append with comma.
            altPhone = altPhone ? `${altPhone},${oldPhone}` : oldPhone;
        }

        // 3. Update DB (Saving the history in alt_phone)
        await db.query(`
            UPDATE customers 
            SET full_name = ?, phone = ?, alt_phone = ?, address = ?
            WHERE id = ?
        `, [full_name, phone, altPhone, address, customerId]);

        // 4. Update Session
        req.session.customer.name = full_name;
        req.session.customer.phone = phone;
        
        req.session.save(() => {
            res.redirect('/account?success=Profile updated successfully');
        });

    } catch (err) {
        console.error("Profile Update Error:", err);
        res.redirect('/account?error=Failed to update profile');
    }
};
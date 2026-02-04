const db = require('../config/database');

// 1. List Customers (Updated Search to include Old Numbers)
exports.getCustomers = async (req, res) => {
    try {
        const { q, page = 1 } = req.query;
        const limit = 15;
        const offset = (page - 1) * limit;

        let sql = `
            SELECT c.*, 
                   COUNT(o.id) as total_orders,
                   COALESCE(SUM(CASE WHEN o.status IN ('delivered', 'POS Complete', 'POS Partial') THEN o.total_amount ELSE 0 END), 0) as total_ltv
            FROM customers c
            LEFT JOIN orders o ON c.id = o.customer_id
            WHERE 1=1
        `;
        
        let params = [];

        if (q) {
            // [FIX] Added search in 'alt_phone'
            sql += ` AND (c.phone LIKE ? OR c.alt_phone LIKE ? OR c.full_name LIKE ?)`;
            params.push(`%${q}%`, `%${q}%`, `%${q}%`);
        }

        sql += ` GROUP BY c.id ORDER BY c.id DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const [customers] = await db.query(sql, params);
        
        // Count Query
        let countSql = `SELECT COUNT(*) as count FROM customers WHERE 1=1`;
        let countParams = [];
        if (q) {
            countSql += ` AND (phone LIKE ? OR alt_phone LIKE ? OR full_name LIKE ?)`;
            countParams.push(`%${q}%`, `%${q}%`, `%${q}%`);
        }
        const [total] = await db.query(countSql, countParams);

        res.render('admin/customers/index', {
            title: 'Customers',
            customers,
            currentPage: parseInt(page),
            totalPages: Math.ceil(total[0].count / limit),
            searchTerm: q || ''
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading customers");
    }
};

// 2. View Single Customer (Fixed: Calculate Stats in JS to ensure accuracy)
exports.getCustomerView = async (req, res) => {
    try {
        const customerId = req.params.id;

        // A. Fetch Customer
        const [cust] = await db.query("SELECT * FROM customers WHERE id = ?", [customerId]);
        if (cust.length === 0) return res.redirect('/admin/customers');
        const customer = cust[0];

        // B. Fetch Order History (Source of Truth)
        const [orders] = await db.query(`
            SELECT id, order_number, created_at, total_amount, status, order_source,
                   (SELECT SUM(quantity) FROM order_items WHERE order_id = orders.id) as total_qty
            FROM orders 
            WHERE customer_id = ? 
            ORDER BY created_at DESC
        `, [customerId]);

        // C. Calculate Stats in JavaScript (100% Accurate)
        let stats = {
            total_ltv: 0,
            total_count: 0,
            online_ltv: 0,
            online_count: 0,
            pos_ltv: 0,
            pos_count: 0
        };

        // Define valid completed statuses
        // Note: We convert status to lowercase to avoid case-sensitive bugs (e.g., "Delivered" vs "delivered")
        const validStatuses = ['delivered', 'pos complete', 'pos partial'];

        orders.forEach(order => {
            const status = (order.status || '').toLowerCase();
            const source = (order.order_source || '').toLowerCase();
            const amount = parseFloat(order.total_amount) || 0;

            if (validStatuses.includes(status)) {
                // Total
                stats.total_ltv += amount;
                stats.total_count++; // Increments count

                // Online
                if (source === 'online' || source === 'website') {
                    stats.online_ltv += amount;
                    stats.online_count++;
                }

                // POS
                if (source === 'pos') {
                    stats.pos_ltv += amount;
                    stats.pos_count++;
                }
            }
        });

        res.render('admin/customers/view', {
            title: customer.full_name,
            customer,
            stats, // Passing the JS-calculated stats
            orders
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading customer profile");
    }
};

// 3. Update Customer (ADMIN SIDE FIX)
exports.updateCustomer = async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const { id, full_name, phone } = req.body;

        // [FIX] Check for phone change logic similar to frontend if you want, 
        // OR just update the profile. 
        // IMPORTANT: I REMOVED the line that updated 'orders' table. 
        // Past orders will now keep the OLD phone number in 'guest_phone' column.
        
        await conn.query(`UPDATE customers SET full_name = ?, phone = ? WHERE id = ?`, [full_name, phone, id]);
        
        // [REMOVED] await conn.query(`UPDATE orders SET guest_phone = ? ...`); 
        // ^ This line was destroying your history. It is now gone.

        await conn.commit();
        res.redirect(`/admin/customers/view/${id}`);
    } catch (err) {
        await conn.rollback();
        console.error(err);
        res.status(500).send("Error updating customer");
    } finally { conn.release(); }
};

exports.getOrderDetailsApi = async (req, res) => {
    try {
        const orderId = req.params.id;
        const [items] = await db.query(`SELECT oi.*, (SELECT image_url FROM product_images pi WHERE pi.product_id = oi.product_id ORDER BY sort_order ASC LIMIT 1) as image FROM order_items oi WHERE oi.order_id = ?`, [orderId]);
        const [order] = await db.query("SELECT * FROM orders WHERE id = ?", [orderId]);
        res.json({ success: true, order: order[0], items });
    } catch (err) { res.json({ success: false, message: err.message }); }
};
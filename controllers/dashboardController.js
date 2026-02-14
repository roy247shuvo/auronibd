const db = require('../config/database');

exports.getDashboard = async (req, res) => {
    try {
        // 1. Calculate Date Ranges
        const today = new Date();
        const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // 2. Fetch Key Metrics (This Month)
        // A. Total Sales (Gross Merchandise Value - GMV)
        const [salesResult] = await db.query(`
            SELECT SUM(total_amount) as total 
            FROM orders 
            WHERE created_at >= ? AND status != 'cancelled'
        `, [firstDayOfMonth]);
        const totalSales = salesResult[0].total || 0;

        // B. Active Orders
        const [activeResult] = await db.query(`
            SELECT COUNT(*) as count 
            FROM orders 
            WHERE status NOT IN ('delivered', 'cancelled', 'returned', 'refunded')
        `);
        const activeOrders = activeResult[0].count || 0;

        // C. New Customers (This Month)
        const [customerResult] = await db.query(`
            SELECT COUNT(*) as count 
            FROM customers 
            WHERE created_at >= ?
        `, [firstDayOfMonth]);
        const newCustomers = customerResult[0].count || 0;

        // 3. Fetch Recent Orders (Top 5)
        const [recentOrders] = await db.query(`
            SELECT id, order_number, guest_name, total_amount, status, created_at 
            FROM orders 
            ORDER BY created_at DESC 
            LIMIT 5
        `);

        // 4. Fetch Graph Data (Last 30 Days Daily Sales)
        const [graphData] = await db.query(`
            SELECT DATE(created_at) as date, SUM(total_amount) as total 
            FROM orders 
            WHERE created_at >= ? AND status != 'cancelled'
            GROUP BY DATE(created_at) 
            ORDER BY date ASC
        `, [thirtyDaysAgo]);

        const chartLabels = graphData.map(d => new Date(d.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
        const chartValues = graphData.map(d => d.total);

        // 5. FETCH LIVE VISITORS (This was missing!)
        // Ensure the table exists or handle empty array
        let visitors = [];
        try {
            // CHANGED: Only fetch visitors who were active in the last 2 minutes
            const [rows] = await db.query(`SELECT * FROM live_visitors WHERE last_active >= NOW() - INTERVAL 2 MINUTE`);
            visitors = rows;
        } catch (e) {
            console.error("Live visitors table missing or error:", e.message);
        }
        
        const onlineCount = visitors.length;

        res.render('admin/dashboard', { 
            title: 'Dashboard',
            layout: 'admin/layout',
            stats: {
                sales: totalSales,
                active_orders: activeOrders,
                new_customers: newCustomers,
                online_users: onlineCount 
            },
            recentOrders,
            chart: {
                labels: JSON.stringify(chartLabels),
                data: JSON.stringify(chartValues)
            },
            mapData: JSON.stringify(visitors), // <--- THIS FIXED THE CRASH
            user: req.session.user
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading dashboard");
    }
};

// [NEW] API to fetch just the live numbers
exports.getLiveStats = async (req, res) => {
    try {
        // CHANGED: Also limit the auto-refresh API to the last 2 minutes
        const [visitors] = await db.query(`SELECT city, lat, lng FROM live_visitors WHERE last_active >= NOW() - INTERVAL 2 MINUTE`);
        res.json({ 
            count: visitors.length,
            visitors: visitors 
        });
    } catch (err) {
        res.status(500).json({ error: 'Error' });
    }
};
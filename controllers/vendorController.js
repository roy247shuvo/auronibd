const db = require('../config/database');

// 1. List Vendors (With Balance Calculation)
exports.getVendorList = async (req, res) => {
    try {
        const search = req.query.search || '';
        let query = `
            SELECT v.*, 
                   COUNT(po.id) as po_count,
                   COALESCE(SUM(po.paid_amount - po.total_amount), 0) as balance
            FROM vendors v
            LEFT JOIN purchase_orders po ON v.id = po.vendor_id
            WHERE 1=1
        `;
        
        const params = [];
        if (search) {
            query += " AND (v.name LIKE ? OR v.phone LIKE ?)";
            params.push(`%${search}%`, `%${search}%`);
        }

        query += " GROUP BY v.id ORDER BY v.id DESC";

        const [vendors] = await db.query(query, params);

        res.render('admin/vendors/index', { 
            title: 'Vendors', 
            vendors,
            search,
            user: req.session.user
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading vendors");
    }
};

// 2. Add Vendor
exports.addVendor = async (req, res) => {
    try {
        const { name, phone, email, address } = req.body;
        // Generate Vendor Code
        const code = 'VEN-' + Date.now().toString().slice(-6); 
        
        await db.query("INSERT INTO vendors (name, vendor_code, phone, email, address) VALUES (?, ?, ?, ?, ?)", 
            [name, code, phone, email, address]);
            
        res.redirect('/admin/vendors');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error adding vendor");
    }
};

// 3. Edit Vendor
exports.editVendor = async (req, res) => {
    try {
        const { id, name, phone, email, address } = req.body;
        await db.query("UPDATE vendors SET name = ?, phone = ?, email = ?, address = ? WHERE id = ?", 
            [name, phone, email, address, id]);
        res.redirect('/admin/vendors');
    } catch (err) {
        res.status(500).send("Error updating vendor");
    }
};

// 4. Delete Vendor
exports.deleteVendor = async (req, res) => {
    try {
        await db.query("DELETE FROM vendors WHERE id = ?", [req.params.id]);
        res.redirect('/admin/vendors');
    } catch (err) {
        res.status(500).send("Error deleting vendor");
    }
};

// 5. Vendor Details
exports.getVendorDetails = async (req, res) => {
    try {
        const vendorId = req.params.id;

        const [vendorData] = await db.query(`
            SELECT v.*, 
                   COUNT(po.id) as po_count,
                   COALESCE(SUM(po.paid_amount - po.total_amount), 0) as balance
            FROM vendors v
            LEFT JOIN purchase_orders po ON v.id = po.vendor_id
            WHERE v.id = ?
            GROUP BY v.id
        `, [vendorId]);

        if (vendorData.length === 0) return res.redirect('/admin/vendors');

        const [recentPOs] = await db.query(`
            SELECT po.*, 
                   (SELECT COALESCE(SUM(quantity), 0) FROM purchase_order_items WHERE po_id = po.id) as total_qty
            FROM purchase_orders po
            WHERE po.vendor_id = ?
            ORDER BY po.created_at DESC
            LIMIT 5
        `, [vendorId]);

        const [accounts] = await db.query("SELECT * FROM bank_accounts WHERE status = 'active' ORDER BY account_name ASC");

        res.render('admin/vendors/details', { 
            title: `Vendor: ${vendorData[0].name}`,
            vendor: vendorData[0],
            recentPOs,
            accounts,
            user: req.session.user
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading details");
    }
};

// 6. Vendor History
exports.getVendorHistory = async (req, res) => {
    try {
        const vendorId = req.params.id;

        const [vendorData] = await db.query(`SELECT * FROM vendors WHERE id = ?`, [vendorId]);
        if (vendorData.length === 0) return res.redirect('/admin/vendors');

        // Add mock PO count if needed or fetch real count
        vendorData[0].po_count = 0; // Simple fallback

        const [allPOs] = await db.query(`
            SELECT po.*, 
                   (SELECT COALESCE(SUM(quantity), 0) FROM purchase_order_items WHERE po_id = po.id) as total_qty
            FROM purchase_orders po
            WHERE po.vendor_id = ?
            ORDER BY po.created_at DESC
        `, [vendorId]);

        const [accounts] = await db.query("SELECT * FROM bank_accounts WHERE status = 'active' ORDER BY account_name ASC");

        res.render('admin/vendors/history', { 
            title: `${vendorData[0].name} - History`,
            vendor: vendorData[0],
            orders: allPOs,
            accounts,
            user: req.session.user
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading history");
    }
};
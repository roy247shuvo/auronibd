const db = require('../config/database');

exports.getSettingsPage = async (req, res) => {
    try {
        const [brands] = await db.query("SELECT * FROM brands");
        const [categories] = await db.query("SELECT * FROM categories");
        const [types] = await db.query("SELECT * FROM product_types");
        const [fabrics] = await db.query("SELECT * FROM fabrics");
        const [work_types] = await db.query("SELECT * FROM work_types");
        const [colors] = await db.query("SELECT * FROM colors");
        const [sizes] = await db.query("SELECT * FROM sizes ORDER BY sort_order ASC");
        
        // [NEW] Fetch Special Features
        const [specials] = await db.query("SELECT * FROM special_features ORDER BY name ASC");

        // Toast Notification Check
        const toast = req.session.toast;
        delete req.session.toast;

        res.render('admin/products/settings', { 
            brands, categories, types, fabrics, work_types, colors, sizes,
            specials, // [NEW] Pass to view
            toast 
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Server Error");
    }
};

exports.saveItem = async (req, res) => {
    const { id, table, name, shortcode, hex_code } = req.body;
    let logoUrl = null;
    if (req.file) logoUrl = req.file.path;

    // [NEW] 1. Check for Duplicate Shortcode (Case Insensitive)
    if (shortcode) {
        // Check only within the current 'table'
        let checkSql = `SELECT id FROM ${table} WHERE shortcode = ?`;
        let checkParams = [shortcode];

        if (id) {
            checkSql += ` AND id != ?`; // Exclude self if editing
            checkParams.push(id);
        }

        const [duplicates] = await db.query(checkSql, checkParams);
        if (duplicates.length > 0) {
            return res.json({ success: false, message: `Shortcode '${shortcode}' is already used in this list.` });
        }
    }

    try {
        // [UPDATED] 2. Generate Slug (Allow Bengali/Unicode characters)
        // Simply trims and replaces spaces with dashes. Does NOT remove special chars.
        const slug = name.trim().toLowerCase().replace(/\s+/g, '-');

        if (id) {
            // === EDIT MODE ===
            let query = `UPDATE ${table} SET name = ?, shortcode = ?`;
            let params = [name, shortcode];

            // [NEW] Update Slug for Brands, Categories & Special Features
            if (table === 'brands' || table === 'categories' || table === 'special_features') {
                query += `, slug = ?`;
                params.push(slug);
            }

            if (logoUrl && table === 'brands') {
                query += `, logo_image = ?`;
                params.push(logoUrl);
            }
            if (hex_code && table === 'colors') {
                query += `, hex_code = ?`;
                params.push(hex_code);
            }
            
            query += ` WHERE id = ?`;
            params.push(id);
            
            await db.query(query, params);
        } 
        else {
            // === ADD MODE ===
            if (table === 'brands') {
                // [UPDATED] Added slug
                await db.query("INSERT INTO brands (name, shortcode, logo_image, slug) VALUES (?, ?, ?, ?)", [name, shortcode, logoUrl, slug]);
            } else if (table === 'categories') {
                // [NEW] Added explicit handler for categories to include slug
                await db.query("INSERT INTO categories (name, shortcode, slug) VALUES (?, ?, ?)", [name, shortcode, slug]);
            } else if (table === 'colors') {
                await db.query("INSERT INTO colors (name, shortcode, hex_code) VALUES (?, ?, ?)", [name, shortcode, hex_code]);
            } else if (table === 'special_features') {
                await db.query("INSERT INTO special_features (name, shortcode, slug) VALUES (?, ?, ?)", [name, shortcode, slug]);
            } else {
                // For Types, Fabrics, Work Types (tables without slug)
                await db.query(`INSERT INTO ${table} (name, shortcode) VALUES (?, ?)`, [name, shortcode]);
            }
        }

        // SUCCESS: Send JSON instead of Redirect
        res.json({ success: true });

    } catch (err) {
        console.error("DB Error:", err);
        
        // ERROR: Send JSON with the message
        if (err.code === 'ER_DUP_ENTRY') {
            // [OPTIONAL] More specific error message
            res.json({ success: false, message: `This Name or Shortcode already exists in the ${table} list.` });
        } else {
            res.json({ success: false, message: 'Database Error: ' + err.message });
        }
    }
};

exports.deleteItem = async (req, res) => {
    const { table, id } = req.body;
    
    // Security: Whitelist allowed tables to prevent SQL injection
    const allowedTables = ['brands', 'categories', 'product_types', 'fabrics', 'work_types', 'colors', 'special_features'];

    if (!allowedTables.includes(table)) {
        return res.json({ success: false, message: "Invalid table." });
    }

    try {
        await db.query(`DELETE FROM ${table} WHERE id = ?`, [id]);
        res.json({ success: true });
    } catch (err) {
        console.error("DB Error:", err);
        // Handle Foreign Key Constraint (if item is used in products)
        if (err.code === 'ER_ROW_IS_REFERENCED_2') {
            res.json({ success: false, message: "Cannot delete: This item is currently used by one or more products." });
        } else {
            res.json({ success: false, message: "Database Error: " + err.message });
        }
    }
};
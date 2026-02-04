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

        // Toast Notification Check
        const toast = req.session.toast;
        delete req.session.toast;

        res.render('admin/products/settings', { 
            brands, categories, types, fabrics, work_types, colors, sizes,
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

    try {
        if (id) {
            // === EDIT MODE ===
            let query = `UPDATE ${table} SET name = ?, shortcode = ?`;
            let params = [name, shortcode];

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
                await db.query("INSERT INTO brands (name, shortcode, logo_image) VALUES (?, ?, ?)", [name, shortcode, logoUrl]);
            } else if (table === 'colors') {
                await db.query("INSERT INTO colors (name, shortcode, hex_code) VALUES (?, ?, ?)", [name, shortcode, hex_code]);
            } else {
                await db.query(`INSERT INTO ${table} (name, shortcode) VALUES (?, ?)`, [name, shortcode]);
            }
        }

        // SUCCESS: Send JSON instead of Redirect
        res.json({ success: true });

    } catch (err) {
        console.error("DB Error:", err);
        
        // ERROR: Send JSON with the message
        if (err.code === 'ER_DUP_ENTRY') {
            res.json({ success: false, message: `The Shortcode "${shortcode}" is already used!` });
        } else {
            res.json({ success: false, message: 'Database Error: ' + err.message });
        }
    }
};
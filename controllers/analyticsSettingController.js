const db = require('../config/database');

// 1. Get Analytics Page
exports.getAnalyticsSettings = async (req, res) => {
    try {
        const [settings] = await db.query("SELECT * FROM shop_settings LIMIT 1");
        const setting = settings.length ? settings[0] : {};

        res.render('admin/settings/analytics', {
            title: 'Meta Pixel & Analytics',
            layout: 'admin/layout',
            setting
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

// 2. Save Analytics Settings
exports.saveAnalyticsSettings = async (req, res) => {
    try {
        // 1. Get data from the form
        const { meta_pixel_id, meta_conversion_api_token, meta_test_code, meta_domain_verification, ga_measurement_id } = req.body;
        
        // 2. Check if settings row exists
        const [check] = await db.query("SELECT id FROM shop_settings LIMIT 1");
        
        if (check.length > 0) {
            // Update existing settings
            await db.query(`
                UPDATE shop_settings 
                SET meta_pixel_id = ?, 
                    meta_conversion_api_token = ?, 
                    meta_test_code = ?, 
                    meta_domain_verification = ?, 
                    ga_measurement_id = ?
                WHERE id = ?
            `, [
                meta_pixel_id, 
                meta_conversion_api_token, 
                meta_test_code, 
                meta_domain_verification, 
                ga_measurement_id, 
                check[0].id
            ]);
        } else {
            // Create new settings row if it doesn't exist
            await db.query(`
                INSERT INTO shop_settings 
                (meta_pixel_id, meta_conversion_api_token, meta_test_code, meta_domain_verification, ga_measurement_id)
                VALUES (?, ?, ?, ?, ?)
            `, [
                meta_pixel_id, 
                meta_conversion_api_token, 
                meta_test_code, 
                meta_domain_verification, 
                ga_measurement_id
            ]);
        }

        res.redirect('/admin/settings/analytics?success=Tracking IDs Updated');
    } catch (err) {
        console.error("Save Error:", err);
        res.redirect('/admin/settings/analytics?error=Failed to update');
    }
};
const db = require('../config/database');

exports.getElements = async (req, res) => {
    try {
        const [lightboxes] = await db.query("SELECT * FROM home_lightboxes ORDER BY sort_order ASC, created_at DESC");
        
        res.render('admin/website/elements', { 
            title: 'Website Elements', 
            path: '/website/elements', 
            lightboxes: lightboxes 
        });
    } catch (err) {
        console.error(err);
        res.status(500).render('error', { message: 'Error loading elements' });
    }
};

exports.saveLightbox = async (req, res) => {
    try {
        const { id, media_type, image_url, title, link, button_text, sort_order, crop_data } = req.body;

        if (id) {
            await db.query(`
                UPDATE home_lightboxes 
                SET media_type=?, image_url=?, title=?, link=?, button_text=?, sort_order=?, crop_data=?
                WHERE id=?
            `, [media_type, image_url, title, link, button_text, sort_order, crop_data, id]);
        } else {
            await db.query(`
                INSERT INTO home_lightboxes 
                (media_type, image_url, title, link, button_text, sort_order, crop_data) 
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [media_type || 'image', image_url, title, link, button_text, sort_order || 0, crop_data]);
        }

        // FIX: Redirect to the new 'elements' route
        res.redirect('/admin/website/elements');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error saving slide: " + err.message);
    }
};

exports.deleteLightbox = async (req, res) => {
    try {
        await db.query("DELETE FROM home_lightboxes WHERE id = ?", [req.params.id]);
        // FIX: Redirect to the new 'elements' route
        res.redirect('/admin/website/elements');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error deleting slide");
    }
};

// GET Checkout Settings Page
exports.getCheckoutSettings = async (req, res) => {
    try {
        const [settings] = await db.query("SELECT * FROM shop_settings WHERE id = 1");
        // NEW: Fetch accounts for the dropdown
        const [accounts] = await db.query("SELECT * FROM bank_accounts WHERE status = 'active'");
        
        res.render('admin/website/checkout_settings', { 
            title: 'Checkout Options',
            settings: settings[0],
            accounts // Pass to view
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading settings');
    }
};

// POST Update Settings
exports.updateCheckoutSettings = async (req, res) => {
    try {
        // Added bkash_deposit_account_id
        const { delivery_inside, delivery_outside, bkash_enabled, bkash_instructions, checkout_advance_delivery, bkash_deposit_account_id } = req.body;
        
        // Added field to SQL query
        await db.query(`
            UPDATE shop_settings 
            SET delivery_inside_dhaka = ?, 
                delivery_outside_dhaka = ?, 
                bkash_enabled = ?, 
                bkash_instructions = ?,
                checkout_advance_delivery = ?,
                bkash_deposit_account_id = ?
            WHERE id = 1
        `, [delivery_inside, delivery_outside, bkash_enabled, bkash_instructions, checkout_advance_delivery, bkash_deposit_account_id || null]);

        res.redirect('/admin/website/checkout-options');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error saving settings');
    }
};
const db = require('../config/database');
const steadfast = require('../config/steadfast');

exports.getGeneralSettings = async (req, res) => {
    try {
        const [settings] = await db.query("SELECT * FROM shop_settings LIMIT 1");
        const setting = settings.length ? settings[0] : {};
        
        // Fetch Balance if API key exists
        let balance = 0;
        if(setting.steadfast_api_key) {
            const b = await steadfast.getBalance();
            balance = b.current_balance || 0;
        }

        res.render('admin/settings/general', {
            title: 'General & Courier Settings',
            layout: 'admin/layout',
            setting,
            balance
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

exports.saveGeneralSettings = async (req, res) => {
    try {
        const { site_url, steadfast_api_key, steadfast_secret_key } = req.body;
        
        // Auto-generate Webhook URL based on Site URL
        const webhook_url = site_url ? `${site_url.replace(/\/$/, '')}/api/steadfast/webhook` : null;

        const [check] = await db.query("SELECT id FROM shop_settings LIMIT 1");
        
        if (check.length > 0) {
            await db.query(`
                UPDATE shop_settings 
                SET site_url = ?, steadfast_api_key = ?, steadfast_secret_key = ?, steadfast_webhook_url = ? 
                WHERE id = ?
            `, [site_url, steadfast_api_key, steadfast_secret_key, webhook_url, check[0].id]);
        } else {
            await db.query(`
                INSERT INTO shop_settings (site_url, steadfast_api_key, steadfast_secret_key, steadfast_webhook_url) 
                VALUES (?, ?, ?, ?)
            `, [site_url, steadfast_api_key, steadfast_secret_key, webhook_url]);
        }

        res.redirect('/admin/settings/general?success=Settings Saved');
    } catch (err) {
        console.error(err);
        res.redirect('/admin/settings/general?error=Failed to save');
    }
};

exports.getStoreSettings = async (req, res) => {
    try {
        const [settings] = await db.query("SELECT * FROM shop_settings LIMIT 1");
        const setting = settings.length ? settings[0] : {};

        res.render('admin/settings/store', {
            title: 'Store Details',
            layout: 'admin/layout',
            setting
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

exports.saveStoreSettings = async (req, res) => {
    try {
        const { shop_name, shop_phone, shop_address, shop_logo } = req.body;
        
        const [check] = await db.query("SELECT id FROM shop_settings LIMIT 1");
        
        if (check.length > 0) {
            await db.query(`
                UPDATE shop_settings 
                SET shop_name = ?, shop_phone = ?, shop_address = ?, shop_logo = ? 
                WHERE id = ?
            `, [shop_name, shop_phone, shop_address, shop_logo, check[0].id]);
        } else {
            await db.query(`
                INSERT INTO shop_settings (shop_name, shop_phone, shop_address, shop_logo) 
                VALUES (?, ?, ?, ?)
            `, [shop_name, shop_phone, shop_address, shop_logo]);
        }

        res.redirect('/admin/settings/store?success=Store details updated');
    } catch (err) {
        console.error(err);
        res.redirect('/admin/settings/store?error=Failed to update');
    }
};
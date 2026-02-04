const db = require('../config/database');

// 1. Get Settings Page
exports.getSMTPSettings = async (req, res) => {
    try {
        const [settings] = await db.query("SELECT * FROM shop_settings LIMIT 1");
        const setting = settings.length ? settings[0] : {};

        res.render('admin/settings/smtp', {
            title: 'SMTP, SMS & Login Settings', // Updated Title
            layout: 'admin/layout',
            setting
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

// 2. Save Settings
exports.saveSMTPSettings = async (req, res) => {
    try {
        const { 
            smtp_host, smtp_port, smtp_user, smtp_pass, 
            sms_api_key,
            firebase_api_key, firebase_auth_domain, firebase_project_id, 
            firebase_storage_bucket, firebase_messaging_sender_id, firebase_app_id 
        } = req.body;
        
        const [check] = await db.query("SELECT id FROM shop_settings LIMIT 1");
        
        if (check.length > 0) {
            await db.query(`
                UPDATE shop_settings 
                SET smtp_host = ?, smtp_port = ?, smtp_user = ?, smtp_pass = ?, 
                    sms_api_key = ?,
                    firebase_api_key = ?, firebase_auth_domain = ?, firebase_project_id = ?,
                    firebase_storage_bucket = ?, firebase_messaging_sender_id = ?, firebase_app_id = ?
                WHERE id = ?
            `, [
                smtp_host, smtp_port, smtp_user, smtp_pass, 
                sms_api_key,
                firebase_api_key, firebase_auth_domain, firebase_project_id,
                firebase_storage_bucket, firebase_messaging_sender_id, firebase_app_id,
                check[0].id
            ]);
        }

        res.redirect('/admin/settings/smtp?success=Settings Updated');
    } catch (err) {
        console.error(err);
        res.redirect('/admin/settings/smtp?error=Failed to update');
    }
};
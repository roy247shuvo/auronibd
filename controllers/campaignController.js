const db = require('../config/database');
const axios = require('axios'); // [FIX] Use Axios for API calls

// [UPDATED] Get SMS Page with Settings & Customers
exports.getSmsCampaigns = async (req, res) => {
    try {
        const [settings] = await db.query("SELECT sms_api_key, sms_sender_id, sms_confirmation_enabled FROM shop_settings LIMIT 1");
        // [NEW] Fetch Customers for selection
        const [customers] = await db.query("SELECT id, full_name, phone FROM customers WHERE phone IS NOT NULL ORDER BY id DESC");

        res.render('admin/campaigns/sms', { 
            title: 'SMS Campaigns',
            path: '/admin/campaigns/sms',
            sms: settings[0] || {},
            customers: customers // Pass to view
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading SMS page");
    }
};

// [NEW] Send Bulk SMS
exports.sendSmsCampaign = async (req, res) => {
    try {
        const { message, recipient_type, manual_numbers, selected_customers } = req.body;

        // 1. Get Credentials
        const [settings] = await db.query("SELECT sms_api_key, sms_sender_id FROM shop_settings LIMIT 1");
        const { sms_api_key, sms_sender_id } = settings[0];

        if (!sms_api_key) return res.redirect('/admin/campaigns/sms?error=API Key not configured');

        // 2. Gather Recipients
        let numbers = [];

        if (recipient_type === 'manual') {
            if (manual_numbers) {
                numbers = manual_numbers.split(',').map(n => n.trim());
            }
        } else if (recipient_type === 'customers') {
            if (selected_customers) {
                const ids = Array.isArray(selected_customers) ? selected_customers : [selected_customers];
                if (ids.length > 0) {
                    const [custData] = await db.query("SELECT phone FROM customers WHERE id IN (?)", [ids]);
                    numbers = custData.map(c => c.phone);
                }
            }
        }

        // 3. Validate & Format Numbers (BulkSMSBD requires 88017...)
        const validNumbers = numbers
            .map(n => n.replace(/\D/g, '')) // Remove non-digits
            .filter(n => n.length >= 11)    // Must be valid length
            .map(n => n.startsWith('01') ? '88' + n : n); // Add 88 prefix if missing

        if (validNumbers.length === 0) return res.redirect('/admin/campaigns/sms?error=No valid numbers selected');

        const numberStr = validNumbers.join(',');

        // 4. Send to Bulk SMS BD API (Fixed with Axios)
        // We use URLSearchParams to send data as 'application/x-www-form-urlencoded'
        const params = new URLSearchParams();
        params.append('api_key', sms_api_key);
        params.append('senderid', sms_sender_id);
        params.append('number', numberStr);
        params.append('message', message);

        console.log("Sending SMS to:", numberStr); // Debug Log

        const response = await axios.post('http://bulksmsbd.net/api/smsapi', params);
        const result = response.data;

        console.log("SMS API Result:", result); // Debug Log

        // 5. Handle Response (Code 202 is success)
        if (result.response_code === 202) {
            res.redirect(`/admin/campaigns/sms?success=SMS Sent to ${validNumbers.length} recipients`);
        } else {
            res.redirect(`/admin/campaigns/sms?error=Gateway Error: ${result.error_message || 'Unknown'}`);
        }

    } catch (err) {
        console.error("SMS Campaign Error:", err);
        res.redirect('/admin/campaigns/sms?error=Internal Server Error');
    }
};

// [NEW] Save SMS Settings & Credentials
exports.saveSmsSettings = async (req, res) => {
    try {
        const { sms_api_key, sms_sender_id, sms_confirmation_enabled } = req.body;
        
        // Update existing row
        await db.query(`
            UPDATE shop_settings 
            SET sms_api_key = ?, sms_sender_id = ?, sms_confirmation_enabled = ? 
            WHERE id = 1
        `, [sms_api_key, sms_sender_id, sms_confirmation_enabled || 'no']);

        res.redirect('/admin/campaigns/sms?success=Settings Updated');
    } catch (err) {
        console.error(err);
        res.redirect('/admin/campaigns/sms?error=Failed to save settings');
    }
};

// [NEW] Get Balance from Bulk SMS BD (Fixed with Axios)
exports.getSmsBalance = async (req, res) => {
    try {
        const [settings] = await db.query("SELECT sms_api_key FROM shop_settings LIMIT 1");
        const apiKey = settings[0]?.sms_api_key;

        if (!apiKey) return res.json({ error: "API Key not configured" });

        // [FIX] Use Axios instead of fetch
        const response = await axios.get(`http://bulksmsbd.net/api/getBalanceApi?api_key=${apiKey}`);
        
        console.log("Balance Response:", response.data); // Debug Log
        res.json(response.data);

    } catch (err) {
        console.error("SMS Balance Check Error:", err.message);
        res.json({ error: "Connection Failed" });
    }
};

exports.getMetaCampaigns = (req, res) => {
    res.render('admin/campaigns/meta', { 
        title: 'Meta Campaigns',
        path: '/admin/campaigns/meta' 
    });
};

exports.getSubscribers = async (req, res) => {
    try {
        const [subscribers] = await db.query("SELECT * FROM subscribers ORDER BY created_at DESC");
        
        res.render('admin/campaigns/subscribers', { 
            title: 'Subscribers List',
            path: '/admin/campaigns/subscribers',
            subscribers
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading subscribers");
    }
};

// NEW: Delete Subscriber
exports.deleteSubscriber = async (req, res) => {
    try {
        const { id } = req.body;
        await db.query("DELETE FROM subscribers WHERE id = ?", [id]);
        res.redirect('/admin/campaigns/subscribers');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error deleting subscriber");
    }
};
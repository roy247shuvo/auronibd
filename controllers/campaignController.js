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

// [UPDATED] Get Meta Page with Feed URL & Synced Products List
exports.getMetaCampaigns = async (req, res) => {
    try {
        const feedUrl = `${req.protocol}://${req.get('host')}/api/meta/catalog.xml`;

        // [NEW] Fetch the actual products that are being synced
        // Criteria: is_online = 'yes' AND stock > 0
        const [products] = await db.query(`
            SELECT 
                p.id, p.sku, p.name, p.regular_price, p.sale_price, p.stock_quantity,
                (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY sort_order ASC LIMIT 1) as main_image
            FROM products p 
            WHERE p.is_online = 'yes' AND p.stock_quantity > 0
            ORDER BY p.created_at DESC  
        `);
        
        // ^^^ FIXED: Changed 'updated_at' to 'created_at' ^^^

        res.render('admin/campaigns/meta', { 
            title: 'Meta Campaigns',
            path: '/admin/campaigns/meta',
            feedUrl: feedUrl,
            products: products // Pass products to view
        });
    } catch (err) {
        console.error("Meta Page Error:", err);
        res.status(500).send("Error loading Meta page");
    }
};

// [FIXED] Corrected 'is_online' Column Name
exports.getProductFeed = async (req, res) => {
    try {
        // 1. Setup Base URL (Force HTTPS)
        const host = req.get('host') || 'auronibd.com';
        const protocol = 'https';
        const baseUrl = `${protocol}://${host}`;

        console.log(`[Meta Feed] Generating feed for ${baseUrl}`);

        // 2. Fetch Active Products (Fixed Column Name: is_online)
        const [products] = await db.query(`
            SELECT 
                p.id, p.sku, p.name, p.description, 
                p.regular_price, p.sale_price, p.stock_quantity,
                COALESCE(b.name, 'Auroni') as brand_name,
                (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY sort_order ASC LIMIT 1) as main_image
            FROM products p 
            LEFT JOIN brands b ON p.brand_id = b.id
            WHERE p.is_online = 'yes' AND p.stock_quantity > 0
        `);

        // 3. Helper: Format Price (Must be 00.00 BDT)
        const formatPrice = (amount) => {
            const num = parseFloat(amount);
            if (isNaN(num)) return '0.00 BDT';
            return num.toFixed(2) + ' BDT';
        };

        // 4. Helper: Sanitize Text (Prevents XML Breakage)
        const sanitize = (text) => {
            if (!text) return "";
            return String(text)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&apos;')
                .replace(/[\x00-\x1F\x7F-\x9F]/g, "") 
                .trim();
        };

        // 5. Build XML Header
        let xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
<channel>
<title>${sanitize(process.env.APP_NAME || 'Auroni BD')} Catalogue</title>
<link>${baseUrl}</link>
<description>Product Feed</description>
`;

        // 6. Loop Products
        for (const p of products) {
            if (!p.sku) continue; // Skip if missing SKU

            const link = `${baseUrl}/product/${p.sku}`;
            
            // Handle Image URL
            let img = "";
            if (p.main_image) {
                img = p.main_image.startsWith('http') ? p.main_image : `${baseUrl}${p.main_image}`;
            }

            // Price Logic
            const price = formatPrice(p.regular_price);
            let salePriceTag = '';
            if (p.sale_price > 0 && p.sale_price < p.regular_price) {
                salePriceTag = `<g:sale_price>${formatPrice(p.sale_price)}</g:sale_price>`;
            }

            // Description Fallback
            const description = sanitize(p.description) || sanitize(p.name);

            // Append Item
            xml += `<item>
    <g:id>${sanitize(p.sku)}</g:id>
    <g:title>${sanitize(p.name)}</g:title>
    <g:description>${description}</g:description>
    <g:link>${link}</g:link>
    <g:image_link>${img}</g:image_link>
    <g:brand>${sanitize(p.brand_name)}</g:brand>
    <g:condition>new</g:condition>
    <g:availability>in_stock</g:availability>
    <g:price>${price}</g:price>
    ${salePriceTag}
    <g:inventory>${p.stock_quantity}</g:inventory>
</item>
`;
        }

        // 7. Close XML
        xml += `</channel>
</rss>`;

        // 8. Send Response
        res.set('Content-Type', 'application/xml; charset=utf-8');
        res.send(xml.trim());

    } catch (err) {
        console.error("Feed Generation Error:", err);
        res.status(500).type('text/plain').send(`Feed Error:\n\n${err.message}\n\n${err.stack}`);
    }
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
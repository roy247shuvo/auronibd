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

// [UPDATED] Meta Page with Price & Compare Price Columns
exports.getMetaCampaigns = async (req, res) => {
    try {
        const feedUrl = `${req.protocol}://${req.get('host')}/api/meta/catalog.xml`;

        // [FIX] Fetch Real Stock & Both Price Columns
        // Note: Based on your saveProduct logic:
        // p.sale_price stores the 'Price' (High/Original)
        // p.regular_price stores the 'Compare Price' (Selling/Actual)
        const [products] = await db.query(`
            SELECT 
                p.id, p.sku, p.name, p.is_preorder,
                p.sale_price as original_price, 
                p.regular_price as selling_price,
                COALESCE((SELECT SUM(stock_quantity) FROM product_variants WHERE product_id = p.id), 0) as real_stock,
                (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY sort_order ASC LIMIT 1) as main_image
            FROM products p 
            WHERE p.is_online = 'yes' 
            HAVING (real_stock > 0 OR p.is_preorder = 'yes')
            ORDER BY p.created_at DESC
        `);
        
        res.render('admin/campaigns/meta', { 
            title: 'Meta Campaigns',
            path: '/admin/campaigns/meta',
            feedUrl: feedUrl,
            products: products 
        });
    } catch (err) {
        console.error("Meta Page Error:", err);
        res.status(500).send("Error loading Meta page");
    }
};

// [FIXED] Meta Feed with User's Custom Price Logic
// Logic: 'price' is Original/High. 'compare_price' is Selling/Actual.
exports.getProductFeed = async (req, res) => {
    try {
        const host = req.get('host') || 'auronibd.com';
        const protocol = 'https';
        const baseUrl = `${protocol}://${host}`;

        console.log(`[Meta Feed] Generating feed for ${baseUrl} (Custom Price Logic)`);

        // [QUERY] Fetch Variants
        // v.price = DB Original Price
        // v.compare_price = DB Selling Price
        const [rows] = await db.query(`
            SELECT 
                v.id as variant_id, 
                v.sku as variant_sku, 
                v.price as db_high_price, 
                v.compare_price as db_selling_price, 
                v.stock_quantity,
                v.color, 
                v.size,
                p.id as product_id, 
                p.sku as group_id, 
                p.name as product_name, 
                p.description, 
                p.is_preorder,
                COALESCE(f.name, 'Cotton') as material_name,
                COALESCE(b.name, 'Auroni') as brand_name,
                (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY sort_order ASC LIMIT 1) as main_image
            FROM product_variants v
            JOIN products p ON v.product_id = p.id
            LEFT JOIN fabrics f ON p.fabric_id = f.id
            LEFT JOIN brands b ON p.brand_id = b.id
            WHERE p.is_online = 'yes'
            HAVING (v.stock_quantity > 0 OR p.is_preorder = 'yes')
        `);

        // Helpers
        const formatPrice = (amount) => {
            const num = parseFloat(amount);
            if (isNaN(num)) return '0.00 BDT';
            return num.toFixed(2) + ' BDT';
        };

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

        let xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
<channel>
<title>${sanitize(process.env.APP_NAME || 'Auroni BD')} Catalogue</title>
<link>${baseUrl}</link>
<description>Product Variant Feed</description>
`;

        for (const row of rows) {
            const uniqueId = row.variant_sku || `VAR-${row.variant_id}`;
            const link = `${baseUrl}/product/${row.group_id}`;
            
            let img = "";
            if (row.main_image) {
                img = row.main_image.startsWith('http') ? row.main_image : `${baseUrl}${row.main_image}`;
            }

            // === [FIX] Custom Price Logic ===
            // DB 'price' is the Original/High Price (g:price)
            // DB 'compare_price' is the Selling Price (g:sale_price)
            
            let metaPrice = row.db_high_price; // Default: The High Price
            let metaSalePriceTag = '';

            // Check if there is a valid selling price that is LOWER than the high price
            if (row.db_selling_price > 0 && row.db_selling_price < row.db_high_price) {
                // It is a Sale
                // g:price = Original (db_high_price)
                // g:sale_price = Selling (db_selling_price)
                metaSalePriceTag = `<g:sale_price>${formatPrice(row.db_selling_price)}</g:sale_price>`;
            } 
            else if (row.db_selling_price > 0 && row.db_selling_price >= row.db_high_price) {
                // If Selling Price is higher or equal to "High Price", treat Selling as the only price
                // This handles cases where data might be messy (e.g. no discount)
                metaPrice = row.db_selling_price;
            }
            // Else: If db_selling_price is 0, we assume 'db_high_price' is the only price.

            // Description & Title
            const description = sanitize(row.description) || sanitize(row.product_name);
            let variantTitle = row.product_name;
            if (row.color && row.color !== 'N/A') variantTitle += ` - ${row.color}`;
            if (row.size && row.size !== 'N/A') variantTitle += ` / ${row.size}`;

            // Availability
            let availability = 'in_stock';
            if (row.stock_quantity <= 0 && row.is_preorder === 'yes') {
                availability = 'preorder';
            }

            xml += `<item>
    <g:id>${sanitize(uniqueId)}</g:id>
    <g:item_group_id>${sanitize(row.group_id)}</g:item_group_id>
    <g:title>${sanitize(variantTitle)}</g:title>
    <g:description>${description}</g:description>
    <g:link>${link}</g:link>
    <g:image_link>${img}</g:image_link>
    <g:brand>${sanitize(row.brand_name)}</g:brand>
    <g:condition>new</g:condition>
    <g:availability>${availability}</g:availability>
    <g:price>${formatPrice(metaPrice)}</g:price>
    ${metaSalePriceTag}
    <g:inventory>${row.stock_quantity}</g:inventory>
    <g:material>${sanitize(row.material_name)}</g:material>
    ${row.color !== 'N/A' ? `<g:color>${sanitize(row.color)}</g:color>` : ''}
    ${row.size !== 'N/A' ? `<g:size>${sanitize(row.size)}</g:size>` : ''}
</item>
`;
        }

        xml += `</channel>
</rss>`;

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
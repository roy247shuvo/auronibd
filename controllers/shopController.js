const db = require('../config/database');
const requestIp = require('request-ip'); 
const geoip = require('geoip-lite');     
const metaService = require('../config/metaService');

// --- HELPER: Fetch ONLY In-Stock Sidebar Data (Fixed Column Name) ---
async function getGlobalData() {
    // 1. Brands (Active + Has Stock in Product OR Variants)
    const [brands] = await db.query(`
        SELECT DISTINCT b.* FROM brands b 
        JOIN products p ON p.brand_id = b.id 
        WHERE p.is_online = 'yes' 
        AND p.stock_quantity > 0
        ORDER BY b.name ASC
    `);

    // 2. Categories
    const [categories] = await db.query(`
        SELECT DISTINCT c.* FROM categories c 
        JOIN products p ON p.category_id = c.id 
        LEFT JOIN product_variants pv ON pv.product_id = p.id 
        WHERE p.is_online = 'yes' 
        AND (p.stock_quantity > 0 OR pv.stock_quantity > 0)
        ORDER BY c.name ASC
    `);

    // 3. Fabrics
    const [fabrics] = await db.query(`
        SELECT DISTINCT f.* FROM fabrics f 
        JOIN products p ON p.fabric_id = f.id 
        LEFT JOIN product_variants pv ON pv.product_id = p.id 
        WHERE p.is_online = 'yes' 
        AND (p.stock_quantity > 0 OR pv.stock_quantity > 0)
        ORDER BY f.name ASC
    `);

    // 4. Work Types
    const [work_types] = await db.query(`
        SELECT DISTINCT w.* FROM work_types w 
        JOIN products p ON p.work_type_id = w.id 
        LEFT JOIN product_variants pv ON pv.product_id = p.id 
        WHERE p.is_online = 'yes' 
        AND (p.stock_quantity > 0 OR pv.stock_quantity > 0)
        ORDER BY w.name ASC
    `);

    // 5. Colors (Only show colors that are actually in stock)
    const [colors] = await db.query(`
        SELECT DISTINCT c.* FROM colors c
        JOIN product_variants pv ON pv.color = c.name
        JOIN products p ON p.id = pv.product_id
        WHERE p.is_online = 'yes' AND pv.stock_quantity > 0
        ORDER BY c.name ASC
    `);
    
    // Collections (Table has 'status', so this is correct)
    const [collections] = await db.query("SELECT * FROM collections WHERE status = 'active' ORDER BY created_at DESC");

    // [NEW] Special Features (For Sidebar Filter)
    // Only fetch features that are actually used by online, in-stock products
    const [specials] = await db.query(`
        SELECT DISTINCT s.* FROM special_features s
        JOIN products p ON p.special_feature_id = s.id
        WHERE p.is_online = 'yes' AND p.stock_quantity > 0
        ORDER BY s.name ASC
    `);

    // [NEW] Fetch Shop Settings (Firebase & Meta Config)
    const [settings] = await db.query("SELECT * FROM shop_settings LIMIT 1");
    const shopSettings = settings.length ? settings[0] : {};
    
    // Add 'specials' to the return object
    return { brands, categories, collections, colors, fabrics, work_types, shopSettings, specials };
}

// 1. HOMEPAGE CONTROLLER
// 1. HOMEPAGE CONTROLLER
exports.getHome = async (req, res) => {
    try {
        const globalData = await getGlobalData();
        const [lightboxes] = await db.query("SELECT * FROM home_lightboxes ORDER BY sort_order ASC, created_at DESC");

        // --- BACKGROUND STYLE LOGIC ---
        // 1. Define available styles (Now includes poem2)
        const styles = ['poem1', 'poem2']; 
        
        // 2. Pick one randomly
        const randomStyle = styles[Math.floor(Math.random() * styles.length)];

        // --- FIXED MEDIA SUBQUERY (Broader check) ---
        const mediaSubquery = (foreignKey) => `
            (SELECT pi.image_url 
             FROM product_images pi 
             JOIN products p2 ON p2.id = pi.product_id 
             WHERE p2.${foreignKey} = main.id 
             ORDER BY (p2.is_online = 'yes') DESC, RAND() 
             LIMIT 1) as media_url
        `;

        // 1. FABRICS (Relaxed Join)
        const [fabrics] = await db.query(`
            SELECT main.*, COUNT(p.id) as product_count,
            ${mediaSubquery('fabric_id')}
            FROM fabrics main 
            LEFT JOIN products p ON p.fabric_id = main.id 
            GROUP BY main.id 
            HAVING product_count > 0
            ORDER BY main.name ASC
        `);

        // 2. WORK TYPES
        const [work_types] = await db.query(`
            SELECT main.*, COUNT(p.id) as product_count,
            ${mediaSubquery('work_type_id')}
            FROM work_types main 
            LEFT JOIN products p ON p.work_type_id = main.id 
            GROUP BY main.id 
            HAVING product_count > 0
            ORDER BY main.name ASC
        `);

        // 3. COLORS (Robust)
        const [colors] = await db.query(`
            SELECT main.*, COUNT(DISTINCT pv.product_id) as product_count,
            (SELECT pi.image_url 
             FROM product_images pi 
             JOIN products p2 ON p2.id = pi.product_id 
             JOIN product_variants pv2 ON pv2.product_id = p2.id
             WHERE pv2.color = main.name 
             ORDER BY (p2.is_online = 'yes') DESC, RAND() 
             LIMIT 1) as media_url
            FROM colors main 
            JOIN product_variants pv ON pv.color = main.name 
            GROUP BY main.id 
            ORDER BY product_count DESC 
            LIMIT 12
        `);

        // 4. NEW ARRIVALS (Products)
        const [products] = await db.query(`
            SELECT p.*, 
            (SELECT image_url FROM product_images WHERE product_id = p.id ORDER BY sort_order ASC LIMIT 1) as image_url
            FROM products p 
            WHERE (p.is_online = 'yes' OR p.is_online = '1') 
            ORDER BY p.created_at DESC 
            LIMIT 10
        `);

        res.render('shop/home', { 
            title: 'Auroni',
            layout: 'shop/layout',
            lightboxes,
            ...globalData, // <--- 1. MOVED TO TOP (Sets the defaults first)
            
            // 2. Now these specific versions (with images) will overwrite the defaults
            fabrics,      
            work_types,
            colors,
            products,
            bgStyle: randomStyle // <--- Pass the randomly selected style file name
        });
    } catch (err) {
        console.error(err);
        res.status(500).render('error', { message: 'Error loading homepage' });
    }
};

// 2. RENDER SHOP PAGE (Dynamic Title Logic)
exports.getShop = async (req, res) => {
    try {
        const globalData = await getGlobalData();
        let pageTitle = 'The Collection';

        // Determine Title based on URL params with specific formatting
        if (req.query.collection) {
            const [cols] = await db.query("SELECT name FROM collections WHERE id = ?", [req.query.collection]);
            if (cols.length > 0) pageTitle = cols[0].name;
        } else if (req.query.brand) {
             const [br] = await db.query("SELECT name FROM brands WHERE id = ?", [req.query.brand]);
             if (br.length > 0) pageTitle = `Brand : ${br[0].name}`;
        } else if (req.query.category) {
             const [cat] = await db.query("SELECT name FROM categories WHERE id = ?", [req.query.category]);
             if (cat.length > 0) pageTitle = `Category : ${cat[0].name}`;
        } else if (req.query.color) {
            // Capitalize first letter
            const colorName = req.query.color.charAt(0).toUpperCase() + req.query.color.slice(1);
            pageTitle = `Color : ${colorName}`;
        }

        // [NEW] Add Background Logic
        const styles = ['poem1', 'poem2']; 
        const randomStyle = styles[Math.floor(Math.random() * styles.length)];

        res.render('shop/shop', { 
            title: pageTitle, 
            pageTitle: pageTitle, 
            layout: 'shop/layout',
            ...globalData,
            bgStyle: randomStyle // <--- PASS THIS
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading shop");
    }
};

// 3. API: FILTER PRODUCTS (Robust Collection Support & Dynamic Titles)
exports.filterProducts = async (req, res) => {
    try {
        // 1. Destructure all filters including 'collections'
        const { brands, categories, fabrics, work_types, colors, collections, page = 1 } = req.body;
        const limit = 9; 
        const offset = (page - 1) * limit;

        // A. Base Query: Joined 'collection_products' (cp)
        let sql = `SELECT DISTINCT p.*, b.name as brand_name 
                   FROM products p 
                   LEFT JOIN brands b ON p.brand_id = b.id 
                   LEFT JOIN product_variants pv ON p.id = pv.product_id
                   LEFT JOIN collection_products cp ON p.id = cp.product_id 
                   WHERE p.is_online = 'yes' 
                   AND (p.stock_quantity > 0 OR pv.stock_quantity > 0)`;
        
        const params = [];

        // B. Apply Filters
        if (brands && brands.length) { sql += ` AND p.brand_id IN (?)`; params.push(brands); }
        if (categories && categories.length) { sql += ` AND p.category_id IN (?)`; params.push(categories); }
        if (fabrics && fabrics.length) { sql += ` AND p.fabric_id IN (?)`; params.push(fabrics); }
        if (work_types && work_types.length) { sql += ` AND p.work_type_id IN (?)`; params.push(work_types); }

        // [NEW] Special Features Filter
        if (req.body.specials && req.body.specials.length) { 
            sql += ` AND p.special_feature_id IN (?)`; 
            params.push(req.body.specials); 
        }
        
        // Collection Filter (Checks both direct ID and Join Table)
        if (collections && collections.length) { 
            sql += ` AND (p.collection_id IN (?) OR cp.collection_id IN (?))`; 
            params.push(collections, collections); 
        }
        
        // Color Filter
        if (colors && colors.length) {
            sql += ` AND pv.color IN (?)`;
            params.push(colors);
        }

        // C. Group & Order
        sql += ` GROUP BY p.id ORDER BY p.created_at DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const [products] = await db.query(sql, params);

        // D. Fetch Details (Colors, Images, Prices)
        if (products.length > 0) {
            const productIds = products.map(p => p.id);
            
            // Fetch Global Color Map
            const [allColors] = await db.query("SELECT name, hex_code FROM colors");
            const colorMap = {};
            allColors.forEach(c => colorMap[c.name] = c.hex_code);

            const [images] = await db.query(`SELECT * FROM product_images WHERE product_id IN (?) ORDER BY sort_order ASC`, [productIds]);
            const [variants] = await db.query(`SELECT * FROM product_variants WHERE product_id IN (?) AND stock_quantity > 0`, [productIds]);

            products.forEach(p => {
                const pVariants = variants.filter(v => v.product_id === p.id);
                const pImages = images.filter(img => img.product_id === p.id);

                // 1. Process Colors
                const uniqueColorNames = [...new Set(pVariants.map(v => v.color))];
                p.available_colors = uniqueColorNames.map(name => ({
                    name: name,
                    hex: colorMap[name] || '#000000'
                }));

                // 2. Process Images
                if (uniqueColorNames.length > 1) {
                    let curatedImages = [];
                    uniqueColorNames.forEach(color => {
                        const match = pImages.find(img => img.color_name === color);
                        if (match) curatedImages.push(match.image_url);
                    });
                    p.images = curatedImages.length > 0 ? curatedImages : pImages.slice(0, 3).map(i => i.image_url);
                } else {
                    p.images = pImages.slice(0, 3).map(i => i.image_url);
                }
                
                if (p.images.length === 0) p.images = [];

                // 3. Process Prices
                if (pVariants.length > 0) {
                    // Find the variant with the lowest actual selling price to display on the card
                    // We sort by the "Compare Price" (if it exists) or "Price"
                    pVariants.sort((a, b) => {
                        const priceA = Number(a.compare_price || a.price);
                        const priceB = Number(b.compare_price || b.price);
                        return priceA - priceB;
                    });
                
                    const lowest = pVariants[0];
                    p.price = lowest.price; // The Old/High Price
                    p.compare_price = lowest.compare_price; // The Discount/Low Price
                } else {
                    // No variants, use main product columns
                    p.price = Number(p.price); 
                    p.compare_price = p.compare_price ? Number(p.compare_price) : null;
                }
            });
        }

        // --- NEW: DYNAMIC TITLE LOGIC ---
        let dynamicTitle = 'The Collection';
        
        if (collections && collections.length === 1) {
            const [c] = await db.query("SELECT name FROM collections WHERE id = ?", [collections[0]]);
            if(c.length) dynamicTitle = c[0].name;
        } else if (brands && brands.length === 1) {
            const [b] = await db.query("SELECT name FROM brands WHERE id = ?", [brands[0]]);
            if(b.length) dynamicTitle = `Brand : ${b[0].name}`;
        } else if (categories && categories.length === 1) {
            const [c] = await db.query("SELECT name FROM categories WHERE id = ?", [categories[0]]);
            if(c.length) dynamicTitle = `Category : ${c[0].name}`;
        } else if (colors && colors.length === 1) {
             dynamicTitle = `Color : ${colors[0].charAt(0).toUpperCase() + colors[0].slice(1)}`;
        } else if (
            (brands && brands.length > 0) || 
            (categories && categories.length > 0) || 
            (colors && colors.length > 0) ||
            (collections && collections.length > 0)
        ) {
            dynamicTitle = 'Filtered Collection';
        }

        res.json({ products, pageTitle: dynamicTitle });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

// 4. SINGLE PRODUCT PAGE
exports.getProduct = async (req, res) => {
    try {
        const sku = req.params.sku; // Capture SKU from URL
        
        // 1. Fetch Product with ALL details
        const [products] = await db.query(`
            SELECT p.*, 
                   b.name as brand_name, b.logo_image as brand_logo, 
                   c.name as category_name,
                   t.name as type_name,
                   f.name as fabric_name,
                   w.name as work_type_name,
                   s.name as special_feature_name
            FROM products p
            LEFT JOIN brands b ON p.brand_id = b.id
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN product_types t ON p.type_id = t.id
            LEFT JOIN fabrics f ON p.fabric_id = f.id
            LEFT JOIN work_types w ON p.work_type_id = w.id
            LEFT JOIN special_features s ON p.special_feature_id = s.id
            WHERE p.sku = ? AND p.is_online = 'yes'`, // Changed p.slug to p.sku
            [sku]
        );

        if (products.length === 0) {
            // [FIX] Fetch Global Data for Shop Layout (Navbar/Footer)
            const globalData = await getGlobalData();
            
            return res.status(404).render('shop/error', { 
                title: 'পণ্যটি পাওয়া যায়নি',
                message: 'পণ্যটি খুঁজে পাওয়া যায়নি।',
                layout: 'shop/layout', // <--- Force Shop Layout
                ...globalData // <--- Pass Navbar Data
            });
        }
        const product = products[0];

        // [NEW] Track ViewContent (Server Side)
        try {
            metaService.sendEvent('ViewContent', {
                custom_data: {
                    content_name: product.name,
                    content_ids: [product.id],
                    content_type: 'product',
                    value: product.sale_price || product.regular_price,
                    currency: 'BDT'
                }
            }, req);
        } catch (metaErr) {
            console.warn("Meta Tracking Failed:", metaErr.message);
        }

        // 2. Fetch Assets (Images & Variants)
        const [images] = await db.query("SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order ASC", [product.id]);
        
        // [FIX] Removed 'AND stock_quantity > 0' so Pre-Order variants are actually loaded
        const [variants] = await db.query("SELECT * FROM product_variants WHERE product_id = ? ORDER BY size ASC", [product.id]);

        // 3. Fetch Hex Codes for Colors
        const [allColors] = await db.query("SELECT name, hex_code FROM colors");
        const colorMap = {};
        allColors.forEach(c => colorMap[c.name] = c.hex_code);

        // 4. GROUP DATA BY COLOR (Smart Logic)
        const productData = {
            colors: [],
            hasVariants: variants.length > 0
        };

        if (productData.hasVariants) {
            const uniqueColors = [...new Set(variants.map(v => v.color))];
            
            productData.colors = uniqueColors.map(colorName => {
                // Get variants (sizes) for this specific color
                const colorVariants = variants.filter(v => v.color === colorName);
                
                // Get images tagged with this color
                let colorImages = images.filter(img => img.color_name === colorName);
                
                // Fallback: If no specific images for this color, use generic ones (null color)
                if (colorImages.length === 0) {
                    const generic = images.filter(img => !img.color_name);
                    colorImages = generic.length > 0 ? generic : images;
                }

                return {
                    name: colorName,
                    hex: colorMap[colorName] || '#000000',
                    variants: colorVariants, 
                    images: colorImages
                };
            });
        } else {
            // No variants? Create a "Standard" group so the frontend still works
            productData.colors.push({
                name: 'Standard',
                hex: null,
                variants: [{ size: 'One Size', price: product.sale_price || product.regular_price, stock: product.stock_quantity, id: 0 }],
                images: images
            });
        }

        // 5. Fetch Related Products (Same Category, Different Product)
        const [related] = await db.query(`
            SELECT p.*, b.name as brand_name,
            (SELECT image_url FROM product_images WHERE product_id = p.id ORDER BY sort_order ASC LIMIT 1) as cover_image 
            FROM products p 
            LEFT JOIN brands b ON p.brand_id = b.id
            WHERE p.category_id = ? AND p.id != ? AND p.is_online = 'yes' 
            LIMIT 4`, 
            [product.category_id, product.id]
        );

        // 6. Calculate Min Price for Display
        const minPrice = variants.length > 0 
            ? Math.min(...variants.map(v => Number(v.compare_price || v.price)))
            : Number(product.compare_price || product.price);

        // 7. Fetch Global Data for Menu/Footer
        const globalData = await getGlobalData();

        // [NEW] Add Background Logic
        const styles = ['poem1', 'poem2']; 
        const randomStyle = styles[Math.floor(Math.random() * styles.length)];

        res.render('shop/product', {
            title: product.name,
            layout: 'shop/layout',
            product,
            productData,
            related,
            minPrice,
            ...globalData,
            bgStyle: randomStyle // <--- PASS THIS
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading product");
    }
};

// 4. STATIC PAGES
exports.getPage = async (req, res) => {
    try {
        const globalData = await getGlobalData();
        const page = req.params.page; 
        res.render(`shop/pages/${page}`, { 
            title: page.charAt(0).toUpperCase() + page.slice(1), 
            layout: 'shop/layout',
            ...globalData 
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading page");
    }
};

// GET Contact Page (Updated with Stock Filter)
exports.getContact = async (req, res) => {
    try {
        // Use the helper to get filtered data (only in-stock items)
        const globalData = await getGlobalData();

        res.render('shop/pages/contact', {
            title: 'Contact Us',
            layout: 'shop/layout',
            ...globalData // Spread the filtered data (categories, brands, etc.)
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading contact page");
    }
};

// GET Shipping Policy Page (Updated with Stock Filter)
exports.getShippingPolicy = async (req, res) => {
    try {
        // Use the helper to get filtered data
        const globalData = await getGlobalData();

        res.render('shop/pages/shipping_policy', {
            title: 'Shipping & Delivery Policy',
            layout: 'shop/layout',
            ...globalData
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading policy page");
    }
};

// GET Returns Policy Page
exports.getReturnsPolicy = async (req, res) => {
    try {
        // Fetch Header Data (Filtered by Stock)
        const globalData = await getGlobalData();

        res.render('shop/pages/returns_policy', {
            title: 'Returns & Exchange Policy',
            layout: 'shop/layout',
            ...globalData
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading returns policy");
    }
};

// NEW: Handle Footer Subscription
exports.subscribe = async (req, res) => {
    try {
        const { phone } = req.body;
        
        // Server-side validation (Security)
        const cleanPhone = phone ? phone.replace(/[^0-9]/g, '').slice(-11) : '';
        if (!/^01\d{9}$/.test(cleanPhone)) {
            return res.json({ success: false, message: 'Invalid phone number' });
        }

        // Insert (Ignore if already exists to prevent errors)
        await db.query("INSERT IGNORE INTO subscribers (phone) VALUES (?)", [cleanPhone]);
        
        // --- META PIXEL & CAPI TRACKING ---
        metaService.sendEvent('Lead', {
            phone: cleanPhone, // MetaService will hash this for you
            custom_data: {
                content_name: 'Newsletter Subscription',
                currency: 'BDT',
                value: 0 // Optional: Assign a value to a lead if you want (e.g., 50)
            }
        }, req);
        // ----------------------------------

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

// [NEW] Visitor Heartbeat (Runs every 10s)
exports.heartbeat = async (req, res) => {
    try {
        const clientIp = requestIp.getClientIp(req);
        // Fix for localhost
        const lookupIp = (clientIp === '::1' || clientIp === '127.0.0.1') ? '103.239.147.187' : clientIp;
        
        const geo = geoip.lookup(lookupIp);

        if (geo) {
            await db.query(`
                INSERT INTO live_visitors (ip_address, city, country, lat, lng, last_active)
                VALUES (?, ?, ?, ?, ?, NOW())
                ON DUPLICATE KEY UPDATE last_active = NOW()
            `, [clientIp, geo.city, geo.country, geo.ll[0], geo.ll[1]]);
        }
        res.sendStatus(200);
    } catch (err) {
        // console.error(err); // Silent fail
        res.sendStatus(500);
    }
};

// GET Privacy Policy
exports.getPrivacyPolicy = async (req, res) => {
    try {
        const globalData = await getGlobalData();
        res.render('shop/pages/privacy_policy', { 
            title: 'Privacy Policy', 
            layout: 'shop/layout',
            ...globalData 
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading privacy policy");
    }
};

// GET Terms of Service
exports.getTermsOfService = async (req, res) => {
    try {
        const globalData = await getGlobalData();
        res.render('shop/pages/terms_of_service', { 
            title: 'Terms of Service', 
            layout: 'shop/layout',
            ...globalData 
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading terms of service");
    }
};
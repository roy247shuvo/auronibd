const db = require('../config/database');

// === HELPER: Fetch ALL Filter Data ===
// We must fetch fabrics and work_types because 'shop.ejs' sidebars need them
async function getGlobalData() {
    // 1. Brands
    const [brands] = await db.query(`
        SELECT DISTINCT b.* FROM brands b 
        JOIN products p ON p.brand_id = b.id 
        WHERE p.is_online = 'yes' AND p.stock_quantity > 0 
        ORDER BY b.name ASC
    `);

    // 2. Categories
    const [categories] = await db.query(`
        SELECT DISTINCT c.* FROM categories c 
        JOIN products p ON p.category_id = c.id 
        LEFT JOIN product_variants pv ON pv.product_id = p.id 
        WHERE p.is_online = 'yes' AND (p.stock_quantity > 0 OR pv.stock_quantity > 0)
        ORDER BY c.name ASC
    `);

    // 3. Fabrics (FIX: Added this)
    const [fabrics] = await db.query(`
        SELECT DISTINCT f.* FROM fabrics f 
        JOIN products p ON p.fabric_id = f.id 
        WHERE p.is_online = 'yes' AND p.stock_quantity > 0
        ORDER BY f.name ASC
    `);

    // 4. Work Types (FIX: Added this)
    const [work_types] = await db.query(`
        SELECT DISTINCT w.* FROM work_types w 
        JOIN products p ON p.work_type_id = w.id 
        WHERE p.is_online = 'yes' AND p.stock_quantity > 0
        ORDER BY w.name ASC
    `);

    // 5. Colors
    const [colors] = await db.query(`
        SELECT DISTINCT c.* FROM colors c 
        JOIN product_variants pv ON pv.color = c.name 
        JOIN products p ON p.id = pv.product_id 
        WHERE p.is_online = 'yes' AND pv.stock_quantity > 0 
        ORDER BY c.name ASC
    `);

    // 6. Collections
    const [collections] = await db.query("SELECT * FROM collections WHERE status = 'active' ORDER BY created_at DESC");
    
    return { brands, categories, collections, colors, fabrics, work_types };
}

// 1. Full Search Page (When user presses ENTER)
exports.searchProducts = async (req, res) => {
    try {
        const query = req.query.q ? req.query.q.trim() : '';
        const globalData = await getGlobalData(); // Now returns fabrics & work_types too

        if (!query) return res.redirect('/shop');

        const searchTerm = `%${query}%`;
        
        // Deep Search Query
        const sql = `
            SELECT DISTINCT p.*, 
                   (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY sort_order ASC LIMIT 1) as image,
                   b.name as brand_name, c.name as category_name
            FROM products p
            LEFT JOIN brands b ON p.brand_id = b.id
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN fabrics f ON p.fabric_id = f.id
            LEFT JOIN product_types pt ON p.type_id = pt.id
            LEFT JOIN work_types wt ON p.work_type_id = wt.id
            LEFT JOIN product_variants pv ON p.id = pv.product_id
            WHERE p.is_online = 'yes'
            AND (
                p.name LIKE ? OR p.sku LIKE ? OR p.description LIKE ? OR
                b.name LIKE ? OR c.name LIKE ? OR f.name LIKE ? OR 
                pt.name LIKE ? OR wt.name LIKE ? OR pv.sku LIKE ? OR pv.color LIKE ?
            )
            ORDER BY p.created_at DESC
        `;

        const [products] = await db.query(sql, Array(10).fill(searchTerm));

        // Manually format images for the view (Shop view expects array)
        products.forEach(p => {
            p.images = p.image ? [p.image] : [];
            // Basic price handling for the card
            p.price = Number(p.price);
            p.compare_price = Number(p.compare_price);
            // Mock available_colors for the card logic if needed, or fetch real ones
            p.available_colors = []; 
        });

        res.render('shop/shop', {
            title: `Search: "${query}"`,
            pageTitle: `Search Results for "${query}"`, 
            products,
            layout: 'shop/layout',
            ...globalData, // Passes brands, categories, FABRICS, WORK_TYPES, etc.
            
            // Pass empty selected filters so the sidebar doesn't crash or highlight anything
            selectedCategory: null, 
            selectedBrand: null, 
            selectedCollection: null, 
            selectedColor: null,
            selectedFabric: null,
            selectedWorkType: null,
            
            sort: 'newest', 
            page: 1, 
            totalPages: 1, 
            searchQuery: query
        });

    } catch (err) {
        console.error("Search Error:", err);
        res.status(500).send("Search Error");
    }
};

// 2. Live Search API (For Dropdown)
exports.liveSearch = async (req, res) => {
    try {
        const query = req.query.q ? req.query.q.trim() : '';
        if (query.length < 2) return res.json([]); 

        const searchTerm = `%${query}%`;
        const sql = `
            SELECT DISTINCT p.id, p.name, p.slug, p.sale_price, p.regular_price,
                   (SELECT image_url FROM product_images pi WHERE pi.product_id = p.id ORDER BY sort_order ASC LIMIT 1) as image,
                   b.name as brand_name
            FROM products p
            LEFT JOIN brands b ON p.brand_id = b.id
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN product_variants pv ON p.id = pv.product_id
            WHERE p.is_online = 'yes'
            AND (
                p.name LIKE ? OR p.sku LIKE ? OR b.name LIKE ? OR c.name LIKE ? OR pv.sku LIKE ?
            )
            LIMIT 6
        `;

        const [results] = await db.query(sql, Array(5).fill(searchTerm));
        res.json(results);

    } catch (err) {
        console.error(err);
        res.json([]);
    }
};
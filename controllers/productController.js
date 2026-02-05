const db = require('../config/database');

exports.getInventoryPage = async (req, res) => {
    try {
        // 1. Get All Products (For the Table)
        // After (Fetches 1 random image per product)
        const [products] = await db.query(`
            SELECT p.*, 
            (SELECT image_url FROM product_images WHERE product_id = p.id ORDER BY RAND() LIMIT 1) as random_image 
            FROM products p 
            ORDER BY p.created_at DESC
        `);

        // 2. Get Master Data
        const [categories] = await db.query("SELECT * FROM categories");
        const [brands] = await db.query("SELECT * FROM brands");
        const [fabrics] = await db.query("SELECT * FROM fabrics");
        const [colors] = await db.query("SELECT * FROM colors");
        const [sizes] = await db.query("SELECT * FROM sizes ORDER BY sort_order ASC");
        const [collections] = await db.query("SELECT * FROM collections");
        const [types] = await db.query("SELECT * FROM product_types");
        const [work_types] = await db.query("SELECT * FROM work_types");
        // [NEW] Fetch Specials
        const [specials] = await db.query("SELECT * FROM special_features ORDER BY name ASC");

        // [NEW] Get Next Serial Number (Count + 1)
        const [countResult] = await db.query("SELECT COUNT(*) as count FROM products");
        const nextSerial = countResult[0].count + 1;

        // Render
        res.render('admin/products/index', {
            products,
            categories,
            brands,
            fabrics,
            colors,
            sizes,
            collections,
            types,
            work_types,
            specials, // <--- Pass specials
            nextSerial 
        });
    } catch (error) {
        console.error("Error loading inventory:", error);
        res.send("Error loading page.");
    }
};

exports.saveProduct = async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const { 
            name, description, price, compare_price, sku, sales_channel, 
            brand_id, type_id, category_id, collection_id, work_type_id, fabric_id, special_feature_id, // Added special_feature_id
            track_stock,
            variant_color, variant_size, variant_price, variant_compare, variant_sku, variant_qty, // Removed variant_cost
            image_map_json 
        } = req.body;

        // 1. Insert Main Product
        const [prodResult] = await conn.query(`
            INSERT INTO products 
            (name, slug, description, regular_price, sale_price, cost_price, sku, sales_channel, brand_id, type_id, category_id, collection_id, work_type_id, fabric_id, special_feature_id, stock_quantity)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            name, 
            name.toLowerCase().replace(/ /g, '-') + '-' + Date.now(), 
            description, 
            compare_price || 0, 
            price, 
            0, // Forced 0 for cost_price
            sku,
            sales_channel || 'both',
            brand_id || null, 
            type_id || null, 
            category_id || null, 
            collection_id || null,
            work_type_id || null,
            fabric_id || null,
            special_feature_id || null, // Added param
            0
        ]);

        const productId = prodResult.insertId;

        // 2. Insert Images
        if (image_map_json) {
            const imageMap = JSON.parse(image_map_json); 
            for (const [colorName, urls] of Object.entries(imageMap)) {
                for (let i = 0; i < urls.length; i++) {
                    await conn.query(`
                        INSERT INTO product_images (product_id, color_name, image_url, sort_order)
                        VALUES (?, ?, ?, ?)
                    `, [productId, colorName, urls[i], i]);
                }
            }
        }

        // 3. Insert Variants (UPDATED to include Cost & Compare Price)
        if (variant_sku && variant_sku.length > 0) {
            // Helper to handle single vs array input
            const toArray = (val) => Array.isArray(val) ? val : [val];

            const skus = toArray(variant_sku);
            const colors = toArray(variant_color);
            const sizes = toArray(variant_size);
            const prices = toArray(variant_price);
            const compares = toArray(variant_compare); 
            // REMOVED: costs & qtys array retrieval since they are not in body

            let totalStock = 0; // Will always be 0 initially

            for (let i = 0; i < skus.length; i++) {
                const qty = 0; // Force 0 as per requirement
                // totalStock += qty; // Remained 0

                await conn.query(`
                    INSERT INTO product_variants (product_id, color, size, sku, price, compare_price, cost_price, stock_quantity)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    productId, 
                    colors[i] || 'N/A', 
                    sizes[i] || 'N/A', 
                    skus[i], 
                    prices[i] || price, 
                    compares[i] || 0,    
                    0,       // <--- Forced 0 for Cost Price
                    qty      // <--- Forced 0 for Stock
                ]);
            }

            // Update Total Stock Cache
            await conn.query("UPDATE products SET stock_quantity = ? WHERE id = ?", [totalStock, productId]);
        }

        await conn.commit();
        // Redirect with ID to trigger Print Modal
        res.redirect('/admin/products?new_product_id=' + productId);

    } catch (error) {
        await conn.rollback();
        console.error("Save Error:", error);
        res.send("Error saving product: " + error.message);
    } finally {
        conn.release();
    }
};

// NEW: Delete Product
exports.deleteProduct = async (req, res) => {
    try {
        const { id } = req.params;
        // Cascade delete will handle variants/images if configured in DB
        // But explicit delete is safer for files if you were deleting images from disk (skipping for now)
        
        await db.query("DELETE FROM products WHERE id = ?", [id]);
        
        res.redirect('/admin/products?success=Product Deleted');
    } catch (error) {
        console.error("Delete Error:", error);
        res.redirect('/admin/products?error=Failed to delete product');
    }
};

// [ADD OR REPLACE THIS FUNCTION]
exports.updateProduct = async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        // 1. Extract Data (Added special_feature_id)
        const { 
            id, name, description, price, compare_price, sku, sales_channel,
            brand_id, type_id, category_id, collection_id, work_type_id, fabric_id, special_feature_id, // [NEW]
            track_stock, image_map_json 
        } = req.body;

        // 2. Update Main Product Table
        await conn.query(`
            UPDATE products 
            SET name=?, description=?, regular_price=?, sale_price=?, cost_price=?, sku=?, sales_channel=?, 
            brand_id=?, type_id=?, category_id=?, collection_id=?, work_type_id=?, fabric_id=?, special_feature_id=?, stock_quantity=?
            WHERE id=?
        `, [
            name, 
            description, 
            compare_price || 0, 
            price, 
            0, // Cost Price 0
            sku, 
            sales_channel,
            brand_id || null, 
            type_id || null, 
            category_id || null, 
            collection_id || null, 
            work_type_id || null, 
            fabric_id || null, 
            special_feature_id || null, // [NEW] Save the ID
            0, // Stock (managed by variants)
            id
        ]);

        // 3. Update Images (If changed)
        if (image_map_json) {
            // First, delete existing images to avoid duplicates or orphaned files
            await conn.query("DELETE FROM product_images WHERE product_id = ?", [id]);

            const imageMap = JSON.parse(image_map_json); 
            for (const [colorName, urls] of Object.entries(imageMap)) {
                for (let i = 0; i < urls.length; i++) {
                    await conn.query(`
                        INSERT INTO product_images (product_id, color_name, image_url, sort_order)
                        VALUES (?, ?, ?, ?)
                    `, [id, colorName, urls[i], i]);
                }
            }
        }

        // 4. Update Variants (New logic: Delete old, Insert new)
        // This is safer than trying to update individual rows dynamically
        if (req.body.variant_sku && req.body.variant_sku.length > 0) {
            await conn.query("DELETE FROM product_variants WHERE product_id = ?", [id]);

            const toArray = (val) => Array.isArray(val) ? val : [val];
            const skus = toArray(req.body.variant_sku);
            const colors = toArray(req.body.variant_color);
            const sizes = toArray(req.body.variant_size);
            const prices = toArray(req.body.variant_price);
            const compares = toArray(req.body.variant_compare);
            // const qtys = toArray(req.body.variant_qty); // If you were editing qty

            let totalStock = 0;

            for (let i = 0; i < skus.length; i++) {
                const qty = 0; // Keeping 0 as per your saveProduct logic
                
                await conn.query(`
                    INSERT INTO product_variants (product_id, color, size, sku, price, compare_price, cost_price, stock_quantity)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    id, 
                    colors[i] || 'N/A', 
                    sizes[i] || 'N/A', 
                    skus[i], 
                    prices[i] || price, 
                    compares[i] || 0, 
                    0, 
                    qty
                ]);
            }
            
            // Recalculate stock cache
            await conn.query("UPDATE products SET stock_quantity = ? WHERE id = ?", [totalStock, id]);
        }

        await conn.commit();
        res.redirect('/admin/products?success=Product Updated');

    } catch (error) {
        await conn.rollback();
        console.error("Update Error:", error);
        res.send("Error updating product: " + error.message);
    } finally {
        conn.release();
    }
};
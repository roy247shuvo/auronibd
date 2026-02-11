const db = require('../config/database');

exports.getInventoryPage = async (req, res) => {
    try {
        // 1. Get All Products (For the Table)
        // [FIX] Calculate total stock from variants table to ensure accuracy
        const [products] = await db.query(`
            SELECT p.*, 
            COALESCE((SELECT SUM(stock_quantity) FROM product_variants WHERE product_id = p.id), 0) as stock_quantity,
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
            brand_id, type_id, category_id, collection_id, work_type_id, fabric_id, special_feature_id, 
            is_preorder, // <--- ADD THIS
            track_stock,
            variant_color, variant_size, variant_price, variant_compare, variant_sku, variant_qty, 
            image_map_json 
        } = req.body;

        // 1. Insert Main Product
        const [prodResult] = await conn.query(`
            INSERT INTO products 
            (name, slug, description, regular_price, sale_price, cost_price, sku, sales_channel, brand_id, type_id, category_id, collection_id, work_type_id, fabric_id, special_feature_id, is_preorder, stock_quantity)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            special_feature_id || null,
            is_preorder || 'no', // <--- ADD THIS
            0
        ]);

        const productId = prodResult.insertId;

        // 2. Insert Images
        if (image_map_json) {
            const imageMap = JSON.parse(image_map_json); 
            for (const [colorName, urls] of Object.entries(imageMap)) {
                for (let i = 0; i < urls.length; i++) {
                    await conn.query(`INSERT INTO product_images (product_id, color_name, image_url, sort_order) VALUES (?, ?, ?, ?)`, [productId, colorName, urls[i], i]);
                }
            }
        }

        // 3. Insert Variants
        if (variant_sku && variant_sku.length > 0) {
            const toArray = (val) => Array.isArray(val) ? val : [val];
            const skus = toArray(variant_sku);
            const colors = toArray(variant_color);
            const sizes = toArray(variant_size);
            const prices = toArray(variant_price);
            const compares = toArray(variant_compare); 

            let totalStock = 0;

            for (let i = 0; i < skus.length; i++) {
                const qty = 0; 
                await conn.query(`INSERT INTO product_variants (product_id, color, size, sku, price, compare_price, cost_price, stock_quantity) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
                [productId, colors[i] || 'N/A', sizes[i] || 'N/A', skus[i], prices[i] || price, compares[i] || 0, 0, qty]);
            }
            await conn.query("UPDATE products SET stock_quantity = ? WHERE id = ?", [totalStock, productId]);
        }

        await conn.commit();
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

// [FIXED] Non-Destructive Update Function
exports.updateProduct = async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const { 
            id, name, description, price, compare_price, sku, sales_channel,
            brand_id, type_id, category_id, collection_id, work_type_id, fabric_id, 
            special_feature_id, 
            is_preorder, 
            image_map_json,
            // Variant Arrays
            variant_id, variant_color, variant_size, variant_price, variant_compare, variant_sku 
        } = req.body;

        // 1. Generate Slug if missing (Fixes /product/null issue)
        let slugUpdateSql = "";
        const slugParams = [];
        
        // Check if we need to fix a null slug
        const [currProd] = await conn.query("SELECT slug FROM products WHERE id = ?", [id]);
        if (!currProd[0].slug) {
            const newSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now();
            slugUpdateSql = ", slug=?";
            slugParams.push(newSlug);
        }

        // 2. Update Main Product
        await conn.query(`
            UPDATE products 
            SET name=?, description=?, regular_price=?, sale_price=?, sku=?, sales_channel=?, 
            brand_id=?, type_id=?, category_id=?, collection_id=?, work_type_id=?, fabric_id=?, special_feature_id=?, is_preorder=?
            ${slugUpdateSql}
            WHERE id=?
        `, [
            name, description, compare_price || 0, price, sku, sales_channel,
            brand_id || null, type_id || null, category_id || null, collection_id || null, 
            work_type_id || null, fabric_id || null, special_feature_id || null, 
            is_preorder || 'no',
            ...slugParams, 
            id
        ]);

        // 3. Update Images (Standard replace is fine for images)
        if (image_map_json) {
            await conn.query("DELETE FROM product_images WHERE product_id = ?", [id]);
            const imageMap = JSON.parse(image_map_json); 
            for (const [colorName, urls] of Object.entries(imageMap)) {
                for (let i = 0; i < urls.length; i++) {
                    await conn.query(`INSERT INTO product_images (product_id, color_name, image_url, sort_order) VALUES (?, ?, ?, ?)`, [id, colorName, urls[i], i]);
                }
            }
        }

        // 4. SMART VARIANT UPDATE (The Critical Fix)
        if (variant_sku && variant_sku.length > 0) {
            const toArray = (val) => Array.isArray(val) ? val : [val];
            
            // Incoming Data from Form
            const ids = toArray(variant_id || []);
            const skus = toArray(variant_sku);
            const colors = toArray(variant_color);
            const sizes = toArray(variant_size);
            const prices = toArray(variant_price);
            const compares = toArray(variant_compare);

            // Get existing Variant IDs from DB to detect deletions
            const [existingVars] = await conn.query("SELECT id FROM product_variants WHERE product_id = ?", [id]);
            const existingIds = existingVars.map(v => v.id);
            const keptIds = ids.filter(vid => vid && vid !== '').map(Number);

            // A. Delete variants that are NOT in the form anymore
            const idsToDelete = existingIds.filter(eid => !keptIds.includes(eid));
            if (idsToDelete.length > 0) {
                // Optional: Check for batches before deleting? 
                // For now, we assume user meant to delete them.
                await conn.query("DELETE FROM product_variants WHERE id IN (?)", [idsToDelete]);
            }

            // B. Upsert (Update existing, Insert new)
            let totalStock = 0;

            for (let i = 0; i < skus.length; i++) {
                const vid = ids[i] ? Number(ids[i]) : null;
                const vColor = colors[i] || 'N/A';
                const vSize = sizes[i] || 'N/A';
                const vSku = skus[i];
                const vPrice = prices[i] || price;
                const vCompare = compares[i] || 0;

                if (vid && existingIds.includes(vid)) {
                    // UPDATE Existing Variant (PRESERVES STOCK & ID)
                    await conn.query(`
                        UPDATE product_variants 
                        SET color=?, size=?, sku=?, price=?, compare_price=? 
                        WHERE id=?
                    `, [vColor, vSize, vSku, vPrice, vCompare, vid]);
                    
                    // Add current DB stock to total counter
                    const [stockRes] = await conn.query("SELECT stock_quantity FROM product_variants WHERE id = ?", [vid]);
                    totalStock += stockRes[0]?.stock_quantity || 0;

                } else {
                    // INSERT New Variant (Stock starts at 0)
                    const [res] = await conn.query(`
                        INSERT INTO product_variants 
                        (product_id, color, size, sku, price, compare_price, cost_price, stock_quantity) 
                        VALUES (?, ?, ?, ?, ?, ?, 0, 0)
                    `, [id, vColor, vSize, vSku, vPrice, vCompare]);
                }
            }

            // Update Total Product Stock Display
            // We recalculate from DB to be 100% accurate
            const [sumRes] = await conn.query("SELECT SUM(stock_quantity) as total FROM product_variants WHERE product_id = ?", [id]);
            await conn.query("UPDATE products SET stock_quantity = ? WHERE id = ?", [sumRes[0].total || 0, id]);
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

// 5. VIEW SINGLE PRODUCT (Edit Modal Fetch) - REQUIRED for Edit Modal
exports.getEditProduct = async (req, res) => {
    try {
        const [products] = await db.query("SELECT * FROM products WHERE id = ?", [req.params.id]);
        if (products.length === 0) return res.status(404).send("Product not found");
        
        const p = products[0];
        const [images] = await db.query("SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order ASC", [p.id]);
        const [variants] = await db.query("SELECT * FROM product_variants WHERE product_id = ?", [p.id]);
        
        // Fetch Master Data for Dropdowns
        const [brands] = await db.query("SELECT * FROM brands");
        const [categories] = await db.query("SELECT * FROM categories");
        const [types] = await db.query("SELECT * FROM product_types");
        const [fabrics] = await db.query("SELECT * FROM fabrics");
        const [work_types] = await db.query("SELECT * FROM work_types");
        const [collections] = await db.query("SELECT * FROM collections");
        // [FIX] Ensure Specials are fetched
        const [specials] = await db.query("SELECT * FROM special_features ORDER BY name ASC");
        
        // Colors & Sizes for Variant Generator
        const [allColors] = await db.query("SELECT * FROM colors");
        const [sizes] = await db.query("SELECT * FROM sizes");

        // Prepare Image Map
        const imageMap = { "General": [null, null, null] };
        const selectedColors = [];
        const selectedSizes = [];

        // Fill Image Map
        images.forEach(img => {
            const key = img.color_name || "General";
            if(!imageMap[key]) imageMap[key] = [null, null, null];
            if(img.sort_order < 3) imageMap[key][img.sort_order] = img.image_url;
        });

        // Fill Selected Attributes
        const usedColors = [...new Set(variants.map(v => v.color))].filter(c => c !== 'N/A');
        const usedSizes = [...new Set(variants.map(v => v.size))].filter(s => s !== 'N/A');

        usedColors.forEach(cName => {
            const cObj = allColors.find(ac => ac.name === cName);
            if(cObj) selectedColors.push({ value: cName, code: cObj.shortcode, hex: cObj.hex_code });
        });

        // [UPDATED] Look up shortcode for Sizes too
        usedSizes.forEach(sName => {
            const sObj = sizes.find(s => s.name === sName);
            selectedSizes.push({ value: sName, code: sObj ? sObj.shortcode : '' });
        });

        res.render('admin/products/modals/edit_product', {
            p, images, variants, brands, categories, types, fabrics, work_types, collections, 
            specials, // [FIX] Pass this variable
            allColors, sizes, imageMap, selectedColors, selectedSizes
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading product");
    }
};
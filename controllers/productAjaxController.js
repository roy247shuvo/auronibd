const db = require('../config/database');

exports.getEditProductForm = async (req, res) => {
    try {
        const [products] = await db.query("SELECT * FROM products WHERE id = ?", [req.params.id]);
        const p = products[0];
        
        // Master Data
        const [brands] = await db.query("SELECT * FROM brands");
        const [categories] = await db.query("SELECT * FROM categories");
        const [types] = await db.query("SELECT * FROM product_types");
        const [work_types] = await db.query("SELECT * FROM work_types");
        const [fabrics] = await db.query("SELECT * FROM fabrics");
        const [collections] = await db.query("SELECT * FROM collections");
        const [allColors] = await db.query("SELECT * FROM colors");
        const [sizes] = await db.query("SELECT * FROM sizes ORDER BY sort_order ASC"); // <--- ADDED THIS

        // Fetch Images
        const [images] = await db.query("SELECT * FROM product_images WHERE product_id = ?", [p.id]);
        let imageMap = { "General": [null, null, null] };
        
        // Fetch Variants
        const [variants] = await db.query("SELECT * FROM product_variants WHERE product_id = ?", [p.id]);

        // === 1. PREPARE IMAGE DATA ===
        let colorsFound = new Set();
        images.forEach(img => {
            if(!imageMap[img.color_name]) imageMap[img.color_name] = [null, null, null];
            if(img.sort_order < 3) imageMap[img.color_name][img.sort_order] = img.image_url;
            if(img.color_name !== 'General') colorsFound.add(img.color_name);
        });

        // === 2. PREPARE TAGS DATA ===
        let selectedColors = [];
        let selectedSizes = [];
        let sizesFound = new Set();

        // Add colors from Images
        colorsFound.forEach(cName => {
            const match = allColors.find(c => c.name === cName);
            if(match) selectedColors.push({ value: match.name, code: match.shortcode, hex: match.hex_code });
        });

        // Add colors/sizes from Variants
        variants.forEach(v => {
            // Colors
            if(!selectedColors.find(c => c.value === v.color)) {
                const match = allColors.find(c => c.name === v.color);
                if(match) selectedColors.push({ value: match.name, code: match.shortcode, hex: match.hex_code });
            }
            // Sizes
            if(!sizesFound.has(v.size)) {
                sizesFound.add(v.size);
                selectedSizes.push({ value: v.size, code: '' });
            }
        });

        res.render('admin/products/modals/edit_product', { 
            layout: false,
            p, brands, categories, types, work_types, fabrics, collections, allColors, sizes, // <--- ADDED sizes HERE
            imageMap, selectedColors, selectedSizes, variants 
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading form");
    }
};

exports.getViewProductModal = async (req, res) => {
    try {
        const [products] = await db.query("SELECT * FROM products WHERE id = ?", [req.params.id]);
        const p = products[0];
        const [variants] = await db.query("SELECT * FROM product_variants WHERE product_id = ?", [p.id]);
        const [images] = await db.query("SELECT * FROM product_images WHERE product_id = ?", [p.id]);

        let totalStock = 0;
        variants.forEach(v => totalStock += v.stock_quantity);

        let groupedImages = {};
        images.forEach(img => {
            if(!groupedImages[img.color_name]) groupedImages[img.color_name] = [];
            groupedImages[img.color_name].push(img.image_url);
        });
        
        res.render('admin/products/modals/view_product', { 
            layout: false,
            p, variants, totalStock, groupedImages 
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading view");
    }
};

exports.updateProduct = async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const { 
            id, name, description, sales_channel, price, compare_price, cost_price,
            brand_id, category_id, type_id, work_type_id, fabric_id, collection_id, 
            image_map_json,
            // Variant Arrays
            variant_id, variant_color, variant_size, variant_price, variant_compare, variant_cost, variant_sku, variant_qty
        } = req.body;
        
        // 1. Update Main Info
        await conn.query(`
            UPDATE products 
            SET name=?, description=?, sales_channel=?, regular_price=?, sale_price=?, cost_price=?, 
                brand_id=?, category_id=?, type_id=?, work_type_id=?, fabric_id=?, collection_id=?
            WHERE id=?
        `, [name, description, sales_channel, price, compare_price, cost_price, brand_id, category_id, type_id, work_type_id, fabric_id, collection_id, id]);

        // 2. Update Images
        if (image_map_json) {
            await conn.query("DELETE FROM product_images WHERE product_id = ?", [id]);
            const imageMap = JSON.parse(image_map_json); 
            for (const [colorName, urls] of Object.entries(imageMap)) {
                for (let i = 0; i < urls.length; i++) {
                    await conn.query(`INSERT INTO product_images (product_id, color_name, image_url, sort_order) VALUES (?, ?, ?, ?)`, [id, colorName, urls[i], i]);
                }
            }
        }

        // 3. SYNC VARIANTS
        // A. Delete Variants
        if (variant_id) {
            const submittedIds = Array.isArray(variant_id) ? variant_id.filter(vid => vid !== '') : [variant_id].filter(vid => vid !== '');
            if (submittedIds.length > 0) {
                await conn.query(`DELETE FROM product_variants WHERE product_id = ? AND id NOT IN (?)`, [id, submittedIds]);
            } else {
                 await conn.query(`DELETE FROM product_variants WHERE product_id = ?`, [id]);
            }
        } else {
             await conn.query(`DELETE FROM product_variants WHERE product_id = ?`, [id]);
        }

        // B. Upsert Variants
        if (req.body.variant_sku && req.body.variant_sku.length > 0) {
            // Helper to ensure array
            const toArray = (val) => Array.isArray(val) ? val : [val];
            
            const vIds = toArray(variant_id || []);
            const vColors = toArray(variant_color);
            const vSizes = toArray(variant_size);
            const vSkus = toArray(variant_sku);
            const vPrices = toArray(variant_price);
            const vCompares = toArray(variant_compare);
            const vCosts = toArray(variant_cost);
            const vQtys = toArray(variant_qty);

            let totalStock = 0;

            for (let i = 0; i < vSkus.length; i++) {
                const rowId = vIds[i]; 
                const qty = parseInt(vQtys[i] || 0);
                totalStock += qty;

                if (rowId) {
                    await conn.query(`
                        UPDATE product_variants 
                        SET color=?, size=?, sku=?, price=?, compare_price=?, cost_price=?, stock_quantity=?
                        WHERE id=?
                    `, [vColors[i], vSizes[i], vSkus[i], vPrices[i], vCompares[i], vCosts[i], qty, rowId]);
                } else {
                    await conn.query(`
                        INSERT INTO product_variants (product_id, color, size, sku, price, compare_price, cost_price, stock_quantity)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `, [id, vColors[i], vSizes[i], vSkus[i], vPrices[i], vCompares[i], vCosts[i], qty]);
                }
            }

            await conn.query("UPDATE products SET stock_quantity = ? WHERE id = ?", [totalStock, id]);
        }

        await conn.commit();
        res.redirect('/admin/products');

    } catch (err) {
        await conn.rollback();
        console.error(err);
        res.redirect('/admin/products');
    } finally {
        conn.release();
    }
};

exports.getEditVariantForm = async (req, res) => { res.status(200).send("Deprecated"); };
exports.updateVariant = async (req, res) => { res.status(200).send("Deprecated"); };

// 6. Get Product & Variants JSON (For Barcode Printing)
exports.getProductVariantsJSON = async (req, res) => {
    try {
        const [product] = await db.query("SELECT * FROM products WHERE id = ?", [req.params.id]);
        const [variants] = await db.query("SELECT * FROM product_variants WHERE product_id = ?", [req.params.id]);
        // Also fetch images to show thumbnails
        const [images] = await db.query("SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order ASC", [req.params.id]);
        
        res.json({ success: true, product: product[0], variants, images });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
};
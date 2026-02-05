const db = require('../config/database');
const cloudinary = require('../config/cloudinary');
const fs = require('fs');

// 1. List Collections
exports.getCollectionsPage = async (req, res) => {
    try {
        const [collections] = await db.query(`
            SELECT c.*, COUNT(cp.product_id) as product_count 
            FROM collections c 
            LEFT JOIN collection_products cp ON c.id = cp.collection_id 
            GROUP BY c.id ORDER BY c.created_at DESC
        `);
        res.render('admin/collections/index', { collections });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading collections");
    }
};

// 2. Create / Update Collection
exports.saveCollection = async (req, res) => {
    try {
        const { id, name, existing_image, image_url } = req.body; 
        
        // Priority: 1. New File Upload (if any) 2. Hidden Input URL (from Modal) 3. Existing DB Image
        let finalUrl = existing_image || '';

        // Handle Image Upload (Local -> Cloudinary)
        if (req.file) {
            const result = await cloudinary.uploader.upload(req.file.path, { folder: 'collections' });
            image_url = result.secure_url;
            // fs.unlinkSync(req.file.path); // Uncomment if using diskStorage temp files
        }

        const slug = name.toLowerCase().replace(/ /g, '-').replace(/[^\w-]+/g, '');

        if (id) {
            await db.query("UPDATE collections SET name=?, slug=?, image_url=? WHERE id=?", [name, slug, finalUrl, id]);
        } else {
            await db.query("INSERT INTO collections (name, slug, image_url) VALUES (?, ?, ?)", [name, slug, finalUrl]);
        }
        res.redirect('/admin/collections');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error saving collection");
    }
};

// 3. Delete Collection
exports.deleteCollection = async (req, res) => {
    try {
        await db.query("DELETE FROM collections WHERE id = ?", [req.params.id]);
        res.redirect('/admin/collections');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error deleting collection");
    }
};

// 4. Manage Page (View/Add/Remove Products)
exports.getManagePage = async (req, res) => {
    try {
        const [collection] = await db.query("SELECT * FROM collections WHERE id = ?", [req.params.id]);
        
        // Fetch products in this collection with a random thumbnail
        const [products] = await db.query(`
            SELECT p.*, 
            (SELECT image_url FROM product_images WHERE product_id = p.id ORDER BY RAND() LIMIT 1) as image
            FROM collection_products cp 
            JOIN products p ON cp.product_id = p.id 
            WHERE cp.collection_id = ? 
            ORDER BY cp.added_at DESC
        `, [req.params.id]);

        res.render('admin/collections/manage', { collection: collection[0], products });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading manage page");
    }
};

// 5. Add Product via Barcode (AJAX)
exports.addProductByBarcode = async (req, res) => {
    try {
        const { collection_id, barcode } = req.body;

        // 1. Find Product ID from Variant SKU (Barcode)
        const [variants] = await db.query("SELECT product_id FROM product_variants WHERE sku = ?", [barcode.trim()]);
        
        if (variants.length === 0) {
            return res.json({ success: false, message: "Barcode/SKU not found!" });
        }

        const productId = variants[0].product_id;

        // 2. Check if already exists in collection
        const [exists] = await db.query("SELECT * FROM collection_products WHERE collection_id = ? AND product_id = ?", [collection_id, productId]);
        
        if (exists.length > 0) {
            return res.json({ success: false, message: "Product is already in this collection." });
        }

        // 3. Add to Collection
        await db.query("INSERT INTO collection_products (collection_id, product_id) VALUES (?, ?)", [collection_id, productId]);
        
        res.json({ success: true, message: "Product added successfully!" });
    } catch (err) {
        console.error(err);
        res.json({ success: false, message: "Server Error" });
    }
};

// 6. Remove Product from Collection (AJAX)
exports.removeProduct = async (req, res) => {
    try {
        const { collection_id, product_id } = req.body;
        await db.query("DELETE FROM collection_products WHERE collection_id = ? AND product_id = ?", [collection_id, product_id]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.json({ success: false });
    }
};
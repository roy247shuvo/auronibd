const db = require('../config/database');

// ==========================================
// SECTION 1: RAW MATERIAL INVENTORY MANAGEMENT
// ==========================================

// List Materials (Grouped by Category for the Inventory View)
exports.getMaterials = async (req, res) => {
    try {
        // 1. Fetch Categories
        const [categories] = await db.query("SELECT * FROM material_categories ORDER BY name ASC");
        
        // 2. Fetch Materials with Category Info
        const [materials] = await db.query(`
            SELECT m.*, c.name as category_name 
            FROM raw_materials m
            LEFT JOIN material_categories c ON m.category_id = c.id
            ORDER BY c.name, m.name
        `);

        // 3. Attach Variants to each Material
        // This is efficient enough for typical SME data sizes
        for (let m of materials) {
            const [variants] = await db.query("SELECT * FROM raw_material_variants WHERE raw_material_id = ? ORDER BY name ASC", [m.id]);
            m.variants = variants;
        }

        res.render('admin/production/materials', {
            title: 'Raw Materials Inventory',
            layout: 'admin/layout',
            categories,
            materials
        });
    } catch (err) {
        console.error("Error loading materials:", err);
        res.status(500).send("Error loading materials page");
    }
};

// Create a New Category (e.g., "Fabrics", "Packaging")
exports.createCategory = async (req, res) => {
    try {
        const { name } = req.body;
        await db.query("INSERT INTO material_categories (name) VALUES (?)", [name]);
        res.redirect('/admin/production/materials?success=Category Added');
    } catch (err) {
        console.error(err);
        res.redirect('/admin/production/materials?error=Error adding category');
    }
};

// Create a Parent Material (e.g., "Cotton Fabric")
exports.createMaterial = async (req, res) => {
    try {
        const { name, category_id, unit, description } = req.body;
        await db.query(`
            INSERT INTO raw_materials (name, category_id, unit, description) 
            VALUES (?, ?, ?, ?)
        `, [name, category_id, unit, description]);
        
        res.redirect('/admin/production/materials?success=Material Created');
    } catch (err) {
        console.error(err);
        res.redirect('/admin/production/materials?error=Failed to create material');
    }
};

// Create a Variant (e.g., "Red", "Blue", "XL Box")
// This is where Stock and Cost actually live now
exports.createVariant = async (req, res) => {
    try {
        const { raw_material_id, name, alert_threshold } = req.body;
        await db.query(`
            INSERT INTO raw_material_variants (raw_material_id, name, alert_threshold, stock_quantity, average_cost) 
            VALUES (?, ?, ?, 0, 0)
        `, [raw_material_id, name, alert_threshold || 10]);
        
        res.redirect('/admin/production/materials?success=Variant Added');
    } catch (err) {
        console.error(err);
        res.redirect('/admin/production/materials?error=Failed to add variant');
    }
};



// ==========================================
// SECTION 2: PRODUCTION RUNS (The Factory)
// ==========================================

// Dashboard: Show Active Runs & History
exports.getDashboard = async (req, res) => {
    try {
        // Fetch Active Runs (Planned/In Progress)
        const [activeRuns] = await db.query(`
            SELECT pr.*, p.name as product_name, v.sku, v.color, v.size
            FROM production_runs pr
            JOIN products p ON pr.target_product_id = p.id
            JOIN product_variants v ON pr.target_variant_id = v.id
            WHERE pr.status IN ('planned', 'in_progress')
            ORDER BY pr.id DESC
        `);

        // Fetch Recent History (Completed)
        const [history] = await db.query(`
            SELECT pr.*, p.name as product_name 
            FROM production_runs pr
            JOIN products p ON pr.target_product_id = p.id
            WHERE pr.status = 'completed'
            ORDER BY pr.completion_date DESC LIMIT 10
        `);

        res.render('admin/production/index', {
            title: 'Production Hub',
            layout: 'admin/layout',
            activeRuns,
            history
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading production dashboard");
    }
};

// Create Run Page (The Calculator)
// [UPDATED] Sends structured data for Category->Material->Variant selection
exports.createRunPage = async (req, res) => {
    try {
        // 1. Fetch Products to Manufacture (Target)
        const [products] = await db.query(`
            SELECT p.id, p.name, v.id as variant_id, v.sku, v.size, v.color 
            FROM products p 
            JOIN product_variants v ON p.id = v.product_id 
            ORDER BY p.name ASC
        `);
        
        // 2. Fetch Available Raw Materials (Ingredients)
        // We fetch a flat list that includes Category, Parent Name, and Variant info
        // The Frontend JS will filter this to create the dropdown experience
        const [materials] = await db.query(`
            SELECT 
                m.id as material_id, m.name as material_name, m.unit,
                v.id as variant_id, v.name as variant_name, v.stock_quantity, v.average_cost,
                c.id as category_id, c.name as category_name
            FROM raw_materials m
            JOIN raw_material_variants v ON m.id = v.raw_material_id
            LEFT JOIN material_categories c ON m.category_id = c.id
            WHERE v.stock_quantity > 0 
            ORDER BY c.name, m.name, v.name
        `);

        res.render('admin/production/create', {
            title: 'New Production Run',
            layout: 'admin/layout',
            products,
            materials // Pass full list to view
        });
    } catch (err) {
        console.error("Create Page Error:", err);
        res.status(500).send("Error loading create page");
    }
};

// Store Run (Start Production)
exports.storeRun = async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const { product_variant, quantity, materials, labor_cost, note } = req.body;
        
        // Input Parsing
        const [prodId, varId] = product_variant.split('-');
        const targetQty = parseInt(quantity);
        const labor = parseFloat(labor_cost) || 0;
        // materials is expected to be array of { id: variant_id, qty: usage }
        const matList = typeof materials === 'string' ? JSON.parse(materials) : materials;

        // 1. Generate Run Number (e.g., PR-2026-0005)
        const [last] = await conn.query("SELECT id FROM production_runs ORDER BY id DESC LIMIT 1");
        const nextId = (last[0]?.id || 0) + 1;
        const runNumber = `PR-${new Date().getFullYear()}-${String(nextId).padStart(4, '0')}`;

        // 2. Create the Run Record
        const [run] = await conn.query(`
            INSERT INTO production_runs (run_number, status, target_product_id, target_variant_id, quantity_produced, note, created_by, start_date)
            VALUES (?, 'in_progress', ?, ?, ?, ?, ?, NOW())
        `, [runNumber, prodId, varId, targetQty, note, req.session.user.name]);
        
        const runId = run.insertId;
        let totalMaterialCost = 0;

        // 3. Allocate Materials (Reserve them & Calculate Cost)
        for (const item of matList) {
            const variantId = item.id; // This is the RAW MATERIAL VARIANT ID
            const useQty = parseFloat(item.qty);

            // Fetch latest cost
            const [v] = await conn.query("SELECT average_cost, raw_material_id FROM raw_material_variants WHERE id = ?", [variantId]);
            if(v.length === 0) throw new Error(`Material Variant ID ${variantId} not found`);

            const costPerUnit = parseFloat(v[0].average_cost);
            const lineTotal = costPerUnit * useQty;
            totalMaterialCost += lineTotal;

            // Record this ingredient in the "Recipe"
            await conn.query(`
                INSERT INTO production_materials (production_id, raw_material_id, material_variant_id, quantity_used, cost_at_time, total_cost)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [runId, v[0].raw_material_id, variantId, useQty, costPerUnit, lineTotal]);
        }

        // 4. Update Final Estimated Costs
        const grandTotal = totalMaterialCost + labor;
        const perUnit = targetQty > 0 ? (grandTotal / targetQty) : 0;

        await conn.query(`
            UPDATE production_runs 
            SET total_cost = ?, cost_per_unit = ? 
            WHERE id = ?
        `, [grandTotal, perUnit, runId]);

        await conn.commit();
        res.json({ success: true, redirect: '/admin/production' });

    } catch (err) {
        await conn.rollback();
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        conn.release();
    }
};

// Finalize Run (Complete & Stock Up)
exports.finalizeRun = async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const { id } = req.params;

        // 1. Get Run Details
        const [run] = await conn.query("SELECT * FROM production_runs WHERE id = ?", [id]);
        if (!run.length || run[0].status === 'completed') throw new Error("Invalid run or already completed");
        const r = run[0];

        // 2. Deduct Raw Materials (The "Real" Consumption)
        const [mats] = await conn.query("SELECT * FROM production_materials WHERE production_id = ?", [id]);
        
        for (const m of mats) {
            // Deduct from VARIANT stock
            await conn.query(`
                UPDATE raw_material_variants 
                SET stock_quantity = stock_quantity - ? 
                WHERE id = ?
            `, [m.quantity_used, m.material_variant_id]);

            // Log the usage
            await conn.query(`
                INSERT INTO raw_material_logs (raw_material_id, variant_id, type, quantity_change, reference_id, created_at)
                VALUES (?, ?, 'production_use', ?, ?, NOW())
            `, [m.raw_material_id, m.material_variant_id, -m.quantity_used, id]);
        }

        // 3. Add Finished Goods Stock (FIFO Batch Creation)
        // Note: 'supplier_price' is 0 because this is internal. 'buying_price' is the manufacturing cost.
        await conn.query(`
            INSERT INTO inventory_batches (product_id, variant_id, supplier_price, buying_price, remaining_quantity, production_run_id, is_active)
            VALUES (?, ?, 0, ?, ?, ?, 1)
        `, [r.target_product_id, r.target_variant_id, r.cost_per_unit, r.quantity_produced, id]);

        // 4. Update Main Product Stock Counters (For fast display)
        await conn.query(`UPDATE product_variants SET stock_quantity = stock_quantity + ? WHERE id = ?`, [r.quantity_produced, r.target_variant_id]);
        await conn.query(`UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?`, [r.quantity_produced, r.target_product_id]);

        // 5. Mark Run as Completed
        await conn.query(`UPDATE production_runs SET status = 'completed', completion_date = NOW() WHERE id = ?`, [id]);

        await conn.commit();
        res.redirect('/admin/production?success=Production Completed & Stock Added');

    } catch (err) {
        await conn.rollback();
        console.error(err);
        res.redirect('/admin/production?error=' + encodeURIComponent(err.message));
    } finally {
        conn.release();
    }
};
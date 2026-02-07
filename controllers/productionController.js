const db = require('../config/database');

// --- RAW MATERIAL MANAGEMENT ---

// List all Raw Materials
exports.getMaterials = async (req, res) => {
    try {
        const [materials] = await db.query("SELECT * FROM raw_materials ORDER BY name ASC");
        res.render('admin/production/materials', {
            title: 'Raw Material Inventory',
            layout: 'admin/layout',
            materials
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading materials");
    }
};

// Add New Raw Material
exports.createMaterial = async (req, res) => {
    try {
        const { name, unit, alert_threshold, description } = req.body;
        await db.query(`
            INSERT INTO raw_materials (name, unit, alert_threshold, description, stock_quantity, average_cost) 
            VALUES (?, ?, ?, ?, 0, 0)
        `, [name, unit, alert_threshold, description]);
        
        res.redirect('/admin/production/materials?success=Material Created');
    } catch (err) {
        console.error(err);
        res.redirect('/admin/production/materials?error=Failed to create material');
    }
};

// Add Stock (Purchase Raw Material)
// [CRITICAL] Updates Weighted Average Cost (AVCO)
exports.addMaterialStock = async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        
        const { id, quantity, total_cost, note } = req.body;
        const qty = parseFloat(quantity);
        const cost = parseFloat(total_cost); // Total bill for this purchase
        const unitCost = cost / qty;

        // 1. Get Current State
        const [mat] = await conn.query("SELECT stock_quantity, average_cost FROM raw_materials WHERE id = ? FOR UPDATE", [id]);
        const currentQty = parseFloat(mat[0].stock_quantity || 0);
        const currentAvg = parseFloat(mat[0].average_cost || 0);

        // 2. Calculate New Weighted Average Cost
        // Formula: ((OldQty * OldAvg) + (NewQty * NewUnitCost)) / (OldQty + NewQty)
        const currentTotalValue = currentQty * currentAvg;
        const newTotalValue = currentTotalValue + cost;
        const newTotalQty = currentQty + qty;
        const newAvgCost = newTotalQty > 0 ? (newTotalValue / newTotalQty) : 0;

        // 3. Update Material
        await conn.query(`
            UPDATE raw_materials 
            SET stock_quantity = ?, average_cost = ? 
            WHERE id = ?
        `, [newTotalQty, newAvgCost, id]);

        // 4. Log Transaction
        await conn.query(`
            INSERT INTO raw_material_logs (raw_material_id, type, quantity_change, cost_price, created_at)
            VALUES (?, 'purchase', ?, ?, NOW())
        `, [id, qty, unitCost]);

        await conn.commit();
        res.redirect('/admin/production/materials?success=Stock Added & Cost Updated');

    } catch (err) {
        await conn.rollback();
        console.error(err);
        res.redirect('/admin/production/materials?error=Stock update failed');
    } finally {
        conn.release();
    }
};

// --- PRODUCTION RUNS ---

// Dashboard (List Runs)
exports.getDashboard = async (req, res) => {
    try {
        // Fetch Active Runs
        const [activeRuns] = await db.query(`
            SELECT pr.*, p.name as product_name, v.sku 
            FROM production_runs pr
            JOIN products p ON pr.target_product_id = p.id
            JOIN product_variants v ON pr.target_variant_id = v.id
            WHERE pr.status IN ('planned', 'in_progress')
            ORDER BY pr.id DESC
        `);

        // Fetch Recent History
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
exports.createRunPage = async (req, res) => {
    try {
        const [products] = await db.query(`
            SELECT p.id, p.name, v.id as variant_id, v.sku, v.size, v.color 
            FROM products p 
            JOIN product_variants v ON p.id = v.product_id 
            WHERE p.status = 'active'
            ORDER BY p.name
        `);
        
        const [materials] = await db.query("SELECT * FROM raw_materials WHERE stock_quantity > 0 ORDER BY name ASC");

        res.render('admin/production/create', {
            title: 'New Production Run',
            layout: 'admin/layout',
            products,
            materials
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading create page");
    }
};

// Store Run (Save logic)
exports.storeRun = async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const { product_variant, quantity, materials, labor_cost, note } = req.body;
        // materials is expected to be a JSON string or array: [{id, qty}, {id, qty}]
        
        const [prodId, varId] = product_variant.split('-');
        const targetQty = parseInt(quantity);
        const labor = parseFloat(labor_cost) || 0;
        const matList = typeof materials === 'string' ? JSON.parse(materials) : materials;

        // 1. Generate Run Number
        const [last] = await conn.query("SELECT id FROM production_runs ORDER BY id DESC LIMIT 1");
        const nextId = (last[0]?.id || 0) + 1;
        const runNumber = `PR-${new Date().getFullYear()}-${String(nextId).padStart(4, '0')}`;

        // 2. Create Run Record
        const [run] = await conn.query(`
            INSERT INTO production_runs (run_number, status, target_product_id, target_variant_id, quantity_produced, note, created_by, start_date)
            VALUES (?, 'in_progress', ?, ?, ?, ?, ?, NOW())
        `, [runNumber, prodId, varId, targetQty, note, req.session.user.name]);
        
        const runId = run.insertId;
        let totalMaterialCost = 0;

        // 3. Allocate Materials & Calculate Cost
        for (const item of matList) {
            const matId = item.id;
            const useQty = parseFloat(item.qty);

            // Fetch current AVCO cost
            const [matInfo] = await conn.query("SELECT average_cost, stock_quantity FROM raw_materials WHERE id = ?", [matId]);
            const costPerUnit = parseFloat(matInfo[0].average_cost);
            const lineTotal = costPerUnit * useQty;
            
            totalMaterialCost += lineTotal;

            // Record Usage Plan
            await conn.query(`
                INSERT INTO production_materials (production_id, raw_material_id, quantity_used, cost_at_time, total_cost)
                VALUES (?, ?, ?, ?, ?)
            `, [runId, matId, useQty, costPerUnit, lineTotal]);
        }

        // 4. Update Estimated Costs
        const grandTotal = totalMaterialCost + labor;
        const perUnit = grandTotal / targetQty;

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

// Finalize Run (The Accounting Magic)
exports.finalizeRun = async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const { id } = req.params;

        // 1. Get Run Details
        const [run] = await conn.query("SELECT * FROM production_runs WHERE id = ?", [id]);
        if (!run.length || run[0].status === 'completed') throw new Error("Invalid run");
        const r = run[0];

        // 2. Deduct Raw Materials (Real Inventory Update)
        const [mats] = await conn.query("SELECT * FROM production_materials WHERE production_id = ?", [id]);
        
        for (const m of mats) {
            // Deduct Stock
            await conn.query(`
                UPDATE raw_materials 
                SET stock_quantity = stock_quantity - ? 
                WHERE id = ?
            `, [m.quantity_used, m.raw_material_id]);

            // Log Usage
            await conn.query(`
                INSERT INTO raw_material_logs (raw_material_id, type, quantity_change, reference_id, created_at)
                VALUES (?, 'production_use', ?, ?, NOW())
            `, [m.raw_material_id, -m.quantity_used, id]);
        }

        // 3. Add Finished Goods Stock (FIFO Batch Creation)
        // [CRITICAL] This batch's source is creating the link to Production, not PO
        await conn.query(`
            INSERT INTO inventory_batches (product_id, variant_id, supplier_price, buying_price, remaining_quantity, production_run_id, is_active)
            VALUES (?, ?, ?, ?, ?, ?, 1)
        `, [r.target_product_id, r.target_variant_id, 0, r.cost_per_unit, r.quantity_produced, id]);

        // 4. Update Product Total Stock
        await conn.query(`UPDATE product_variants SET stock_quantity = stock_quantity + ? WHERE id = ?`, [r.quantity_produced, r.target_variant_id]);
        await conn.query(`UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?`, [r.quantity_produced, r.target_product_id]);

        // 5. Mark Complete
        await conn.query(`UPDATE production_runs SET status = 'completed', completion_date = NOW() WHERE id = ?`, [id]);

        await conn.commit();
        res.redirect('/admin/production?success=Production Completed & Stock Added');

    } catch (err) {
        await conn.rollback();
        console.error(err);
        res.redirect('/admin/production?error=' + err.message);
    } finally {
        conn.release();
    }
};
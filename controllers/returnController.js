const db = require('../config/database');

// 1. Show the "Partial Returns" Page
exports.getReturnsPage = async (req, res) => {
    try {
        // [FIXED] Changed ORDER BY o.updated_at to o.created_at
        const [orders] = await db.query(`
            SELECT o.*, 
                   GROUP_CONCAT(CONCAT(oi.product_name, ' (', oi.size, ') x', oi.quantity) SEPARATOR '||') as item_summary
            FROM orders o
            LEFT JOIN order_items oi ON o.id = oi.order_id
            WHERE o.is_steadfast_partial_returned = 0 
            AND o.status = 'Partially_Delivered'
            GROUP BY o.id
            ORDER BY o.created_at DESC
        `);

        res.render('admin/orders/returns_manager', {
            title: 'Steadfast Partial Returns',
            layout: 'admin/layout',
            orders,
            user: req.session.user
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading returns");
    }
};

// 2. Fetch Items for a Specific Order (AJAX Modal)
exports.getOrderItems = async (req, res) => {
    try {
        const { order_id } = req.params;
        const [items] = await db.query(`
            SELECT * FROM order_items WHERE order_id = ?
        `, [order_id]);
        res.json({ success: true, items });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// 3. Process the Restock
exports.processRestock = async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const { order_id, returned_items } = req.body; 
        
        if (!returned_items || returned_items.length === 0) {
            throw new Error("No items selected for return.");
        }

        for (const item of returned_items) {
            const qty = parseInt(item.qty);
            if (qty > 0) {
                // A. Update Order Item (Record that it came back)
                await conn.query(`UPDATE order_items SET returned_quantity = ? WHERE id = ?`, [qty, item.id]);

                // B. Restock Product Variant
                await conn.query(`UPDATE product_variants SET stock_quantity = stock_quantity + ? WHERE id = ?`, [qty, item.variant_id]);

                // C. Restock Main Product Count
                await conn.query(`UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?`, [qty, item.product_id]);

                // D. Update Inventory Batch (FIFO Logic)
                const [batches] = await conn.query(`SELECT id FROM inventory_batches WHERE variant_id = ? ORDER BY id DESC LIMIT 1`, [item.variant_id]);
                if (batches.length > 0) {
                    await conn.query(`UPDATE inventory_batches SET remaining_quantity = remaining_quantity + ? WHERE id = ?`, [qty, batches[0].id]);
                }
            }
        }

        // E. Mark Order as Processed
        await conn.query(`UPDATE orders SET is_steadfast_partial_returned = 1 WHERE id = ?`, [order_id]);

        await conn.commit();
        res.json({ success: true, message: "Partial stock returned to inventory!" });

    } catch (err) {
        await conn.rollback();
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        conn.release();
    }
};
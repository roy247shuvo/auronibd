const db = require('../config/database');
const steadfast = require('../config/steadfast');

exports.syncSettlements = async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        // 1. Fetch Payment Batches from Steadfast
        const paymentsResponse = await steadfast.getPayments();
        
        let payments = [];
        // Handle different API response structures
        if (Array.isArray(paymentsResponse)) payments = paymentsResponse;
        else if (paymentsResponse.data) payments = paymentsResponse.data;

        let processedOrders = 0;
        let processedBatches = 0;

        // 2. Loop through each payment batch
        // We limit to the last 5 batches to ensure speed, as older ones are likely already synced.
        const recentPayments = payments.slice(0, 5); 

        for (const batch of recentPayments) {
            const paymentId = batch.id; // Adjust based on actual API key (e.g., 'id' or 'payment_id')

            // Fetch details (the list of orders in this check)
            const details = await steadfast.getPaymentDetails(paymentId);
            
            let consignments = [];
            if (details && Array.isArray(details.consignments)) consignments = details.consignments;
            else if (details && Array.isArray(details.data)) consignments = details.data;
            else if (Array.isArray(details)) consignments = details;

            if (consignments.length === 0) continue;

            for (const item of consignments) {
                // item contains: invoice, cod_amount, delivery_charge, status
                const invoice = item.invoice;

                // Find the order in our DB (Locking the row for safety)
                const [orders] = await conn.query("SELECT id, status, settled_at FROM orders WHERE order_number = ? FOR UPDATE", [invoice]);

                if (orders.length > 0) {
                    const order = orders[0];

                    // SKIP if already settled (We don't want to double count revenue)
                    if (order.settled_at) continue;

                    // 3. Status Mapping
                    let newStatus = 'delivered'; // Default success
                    if (item.status === 'partial_delivered') newStatus = 'Partially_Delivered';
                    else if (item.status === 'cancelled') newStatus = 'cancelled';

                    // 4. Financial Calculations
                    const grossCOD = parseFloat(item.cod_amount) || 0;
                    const deliveryCharge = parseFloat(item.delivery_charge) || 0;
                    
                    // [NEW] Calculate COD Fee (1% of Cash Collected)
                    const codFee = grossCOD * 0.01; 

                    // 5. Update Database
                    // [UPDATED] We use `gateway_fee = gateway_fee + ?` to ADD to any existing fees (like advance fees)
                    await conn.query(`
                        UPDATE orders 
                        SET status = ?, 
                            payment_status = 'paid',
                            courier_delivery_charge = ?,
                            cod_received = ?, 
                            gateway_fee = gateway_fee + ?,
                            settled_at = NOW() 
                        WHERE id = ?
                    `, [newStatus, deliveryCharge, grossCOD, codFee, order.id]);

                    processedOrders++;
                }
            }
            processedBatches++;
        }

        await conn.commit();
        res.json({ success: true, message: `Synced ${processedOrders} orders from ${processedBatches} batches.` });

    } catch (err) {
        await conn.rollback();
        console.error("Settlement Sync Error:", err);
        res.status(500).json({ success: false, message: "Sync failed: " + err.message });
    } finally {
        conn.release();
    }
};
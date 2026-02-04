const db = require('../config/database');
const crypto = require('crypto');

// === HELPER: Fetch Menu Data (Brands, Categories, etc.) ===
// This ensures the header/menu works on the Tracking Page
async function getGlobalData() {
    // 1. Brands (Active + Stock)
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

    // 3. Colors
    const [colors] = await db.query(`
        SELECT DISTINCT c.* FROM colors c
        JOIN product_variants pv ON pv.color = c.name
        JOIN products p ON p.id = pv.product_id
        WHERE p.is_online = 'yes' AND pv.stock_quantity > 0
        ORDER BY c.name ASC
    `);

    // 4. Collections
    const [collections] = await db.query("SELECT * FROM collections WHERE status = 'active' ORDER BY created_at DESC");
    
    return { brands, categories, collections, colors };
}

// === THE VIBE ENGINE (Message Variations) ===
const getVibeMessage = (steadfastMsg) => {
    const msg = (steadfastMsg || "").toLowerCase();
    
    // 1. Order Created
    if (msg.includes('created by sender')) {
        const msgs = [
            "We have handed over your order to Steadfast! 📦",
            "Packed with love & handed to the courier! 💖",
            "Your goodie bag is officially on its way! 🚀",
            "Mission started! Parcel is with Steadfast now.",
            "A new journey begins! Your parcel has left our hands. ✨",
            "Order packed, labeled, and ready to roll! 🏎️"
        ];
        return msgs[Math.floor(Math.random() * msgs.length)];
    }

    // 2. Pending / Processing
    if (msg.includes('updated as pending')) {
        const msgs = [
            "Steadfast received your order and is preparing to ship! ⚙️",
            "Your parcel is in the queue, getting ready to fly! ✈️",
            "Paperwork done! Getting ready for the journey.",
            "Steadfast says: 'We got this!' (Processing)",
            "Sorting hat says... it's going to you! Processing now. 🪄",
            "Logistics magic in progress. Hang tight!"
        ];
        return msgs[Math.floor(Math.random() * msgs.length)];
    }

    // 3. Sent to Warehouse (Dispatch)
    if (msg.includes('sent to') && msg.includes('warehouse')) {
        const place = msg.split('sent to')[1].split('.')[0].trim(); 
        const msgs = [
            `Steadfast sent your parcel to their BIG sorting area: ${place} 🏭`,
            `On the move! Heading to ${place} warehouse. 🚚`,
            `Zoom! Your parcel is travelling to ${place}.`,
            `Next stop: ${place} Hub!`,
            `Big truck alert! Moving towards the ${place} center. 🚛`,
            `Leaving the nest, heading to ${place} for sorting.`
        ];
        return msgs[Math.floor(Math.random() * msgs.length)];
    }

    // 4. Received at Warehouse
    if (msg.includes('received at') && msg.includes('warehouse')) {
        const msgs = [
            "Steadfast never sleeps! They received your parcel and are loading the truck. 🚛",
            "Safe and sound at the warehouse. Next step: Delivery!",
            "Scanned and ready at the Hub. Getting closer!",
            "Your parcel is chilling at the warehouse, but not for long!",
            "Check-in complete at the sorting facility. All systems go! ✅",
            "Warehouse vibes! Your package is safe and being sorted."
        ];
        return msgs[Math.floor(Math.random() * msgs.length)];
    }

    // 5. Sent to Local Hub (Place Name)
    if (msg.includes('sent to') && !msg.includes('warehouse')) {
        const place = msg.split('sent to')[1].split('.')[0].trim();
        const msgs = [
            `Your parcel is going FAST to ${place}! 🏎️`,
            `Almost there! En route to ${place}.`,
            `Leaving the hub, heading towards ${place}.`,
            `Road trip! Destination: ${place}.`,
            `Speedy delivery mode: ON. Next stop: ${place}. ⚡`,
            `Closer than ever! It's on the way to ${place}.`
        ];
        return msgs[Math.floor(Math.random() * msgs.length)];
    }

    // 6. Received at Local Hub
    if (msg.includes('received at') && !msg.includes('warehouse')) {
        const place = msg.split('received at')[1].split('.')[0].trim();
        const msgs = [
            `Yes! Your parcel is at ${place}. Just a little more! 📍`,
            `Landed at ${place}! The rider will pick it up soon.`,
            `Your parcel has arrived in your area (${place}).`,
            `Touchdown in ${place}! Prepare your excitement.`,
            `Local hub reached: ${place}. It smells like new clothes! 👗`,
            `Hello ${place}! Your package has arrived in the neighborhood.`
        ];
        return msgs[Math.floor(Math.random() * msgs.length)];
    }

    // 7. Assigned to Rider
    if (msg.includes('assigned by rider')) {
        const msgs = [
            "Keep your phone close! The Rider will call you soon. 📞",
            "Rider assigned! Get ready to pick up the phone. 📱",
            "Your personal delivery hero is on the way! Watch your phone.",
            "Ring ring! That might be your rider soon. 🔔",
            "Final stretch! A rider has picked up your parcel."
        ];
        return msgs[Math.floor(Math.random() * msgs.length)];
    }

    // 8. Rider Note / Hold
    if (msg.includes('rider note') || msg.includes('hold')) {
        const msgs = [
            "Delivery man wrote a message. Check the details below! 📝",
            "Update from the road: See the rider's note.",
            "Small pause: The rider left a specific note.",
            "Hold up! Check the status message for details.",
            "Important update from your delivery partner. 👇"
        ];
        return msgs[Math.floor(Math.random() * msgs.length)];
    }

    // 9. Delivered
    if (msg.includes('delivered')) {
        const msgs = [
            "Yes! You received your order. Are you happy? Like our page! 💙",
            "Mission Accomplished! Enjoy your Niche Boutique outfit. ✨",
            "Delivered! We hope you look fabulous. Send us a pic! 📸",
            "Knock knock! It's there. Thanks for shopping with us!",
            "Happiness delivered. Time to unbox! 🎁",
            "It’s yours now! Wear it, love it, flaunt it."
        ];
        return msgs[Math.floor(Math.random() * msgs.length)];
    }

    return steadfastMsg; // Fallback to original text if no match
};

// 1. Render Track Page (GET)
exports.getTrackPage = async (req, res) => {
    try {
        const { id } = req.params; 
        const globalData = await getGlobalData(); 
        let prefillOrder = '';

        if (id) {
            const [rows] = await db.query("SELECT order_number FROM orders WHERE tracking_secret = ?", [id]);
            if (rows.length > 0) prefillOrder = rows[0].order_number;
        }

        res.render('shop/pages/track_order', {
            title: 'Track Your Order',
            layout: 'shop/layout', // Ensures Website Header/Footer
            prefillOrder,
            order: null,
            timeline: [],
            error: null,
            ...globalData // Pass menu data
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Server Error");
    }
};

// 2. Handle Search Logic (POST)
exports.postTrackOrder = async (req, res) => {
    try {
        const { order_id, phone } = req.body;
        const globalData = await getGlobalData();
        
        const cleanPhone = phone ? phone.replace(/[^0-9]/g, '').slice(-11) : '';
        
        // --- NEW: Sanitize Order ID (Remove hyphens, spaces, special chars & Force Uppercase) ---
        // Example: 'nb-on-123' becomes 'NBON123'
        const cleanOrder = order_id ? order_id.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() : '';

        // 1. Find Order (Ignore Hyphens in Database Column too)
        // We strip hyphens from the DB column on-the-fly to match the sanitized input
        const [orders] = await db.query(`
            SELECT o.*, c.full_name, c.phone as cust_phone 
            FROM orders o 
            LEFT JOIN customers c ON o.customer_id = c.id
            WHERE UPPER(REPLACE(o.order_number, '-', '')) = ?
        `, [cleanOrder]);

        if (orders.length === 0) {
            return res.render('shop/pages/track_order', { 
                title: 'Track Order', 
                layout: 'shop/layout', // Ensures Website Header/Footer
                prefillOrder: cleanOrder, 
                order: null, 
                timeline: [], 
                error: 'Order not found. Please check your ID.',
                ...globalData
            });
        }

        const order = orders[0];

        // --- NEW: Block POS Orders ---
        // If order is from POS, stop here and show message.
        if (order.order_source === 'pos') {
            return res.render('shop/pages/track_order', { 
                title: 'Track Order', 
                layout: 'shop/layout', 
                prefillOrder: cleanOrder, 
                order: null, 
                timeline: [], 
                error: 'You bought this from in-store. So no tracking ID is available for this purchase.',
                ...globalData
            });
        }

        // 2. Verify Phone
        const orderGuestPhone = (order.guest_phone || '').replace(/[^0-9]/g, '').slice(-11);
        const orderCustPhone = (order.cust_phone || '').replace(/[^0-9]/g, '').slice(-11);
        
        if (orderGuestPhone !== cleanPhone && orderCustPhone !== cleanPhone) {
            return res.render('shop/pages/track_order', { 
                title: 'Track Order', 
                layout: 'shop/layout', // Ensures Website Header/Footer
                prefillOrder: cleanOrder, 
                order: null, 
                timeline: [], 
                error: 'Phone number does not match this order.',
                ...globalData
            });
        }

        // 3. Generate Secret Link
        if (!order.tracking_secret) {
            const secret = crypto.randomBytes(8).toString('hex');
            await db.query("UPDATE orders SET tracking_secret = ? WHERE id = ?", [secret, order.id]);
            order.tracking_secret = secret;
        }

        // 4. Fetch & Process Timeline
        const [rawTimeline] = await db.query("SELECT * FROM order_timelines WHERE order_id = ? ORDER BY timestamp DESC", [order.id]);

        const timeline = rawTimeline.map(t => ({
            original: t.message,
            vibe_msg: getVibeMessage(t.message), // Applies the new 5+ variations
            time: t.timestamp,
            rider_name: t.rider_name,
            rider_phone: t.rider_phone,
            is_rider_msg: (t.message || "").toLowerCase().includes('assigned by rider')
        }));

        const total = parseFloat(order.total_amount);
        const paid = parseFloat(order.paid_amount);
        const due = total - paid;

        // --- NEW: Save to Session & Redirect ---
        req.session.trackingData = {
            prefillOrder: cleanOrder,
            order: {
                ...order,
                due_amount: due,
                secret_link: `${req.protocol}://${req.get('host')}/track/${order.tracking_secret}`
            },
            timeline,
            error: null
        };

        // Redirect to the result page (Prevents Form Resubmission on Refresh)
        return req.session.save(() => {
            res.redirect('/track/result');
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Server Error");
    }
};

// 3. Render Result Page (PRG Pattern)
exports.getTrackResult = async (req, res) => {
    try {
        const data = req.session.trackingData;

        // If no data in session (e.g., user refreshed the page), reset to search
        if (!data) {
            return res.redirect('/track'); 
        }

        // Clear session so next refresh resets the fields
        req.session.trackingData = null; 

        // Re-fetch global data for the menu
        const globalData = await getGlobalData();

        res.render('shop/pages/track_order', {
            title: 'Track Your Order',
            layout: 'shop/layout',
            ...data,      // spread order, timeline, prefillOrder
            ...globalData // spread brands, categories, etc.
        });

    } catch (err) {
        console.error(err);
        res.redirect('/track');
    }
};
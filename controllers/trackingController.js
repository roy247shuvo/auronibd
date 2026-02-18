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

// === THE VIBE ENGINE (Auroni Aesthetic Bangla Edition) ===
const getVibeMessage = (steadfastMsg) => {
    const msg = (steadfastMsg || "").toLowerCase();
    
    // 1. Order Created (Handover)
    if (msg.includes('created by sender')) {
        const msgs = [
            "আপনার শখের শাড়িটি পরম যত্নে প্যাকেট করা হয়েছে, যাত্রাপথে পা বাড়াল বলে। 🌸",
            "অরণীর ভালোবাসা নিয়ে প্যাকেটটি এখন কুরিয়ারের হাতে। শীঘ্রই দেখা হবে! ✨",
            "একটি নতুন গল্পের শুরু! আপনার পার্সেলটি আমাদের স্টুডিও থেকে বিদায় নিল। 🦋",
            "সুন্দর কিছুর জন্য অপেক্ষা করার আনন্দই আলাদা। যাত্রা শুরু হলো! 📦",
            "প্যাকেজিং শেষ, গায়ে মেখে নতুনের ঘ্রাণ, আপনার ঠিকানায় ছুটল এবার। 🚀"
        ];
        return msgs[Math.floor(Math.random() * msgs.length)];
    }

    // 2. Pending / Processing
    if (msg.includes('updated as pending')) {
        const msgs = [
            "যাত্রার প্রস্তুতি চলছে, খুব শীঘ্রই এটি উড়াল দেবে আপনার আঙ্গিনায়। 🕊️",
            "কাগজপত্রের কাজ শেষ, এখন শুধু আপনার কাছে পৌঁছানোর অপেক্ষা। 📝",
            "সবকিছু গুছিয়ে নেওয়া হচ্ছে, যেন নিখুঁতভাবে আপনার হাতে পৌঁছায়। 🎀",
            "অপেক্ষা মধুর, যদি গন্তব্যে থাকে কাঙ্ক্ষিত কিছু। প্রসেসিং চলছে! ⏳"
        ];
        return msgs[Math.floor(Math.random() * msgs.length)];
    }

    // 3. Sent to Warehouse (Dispatch)
    if (msg.includes('sent to') && msg.includes('warehouse')) {
        const place = msg.split('sent to')[1].split('.')[0].trim(); 
        const msgs = [
            `বাতাসে আনন্দের ঘ্রাণ, আপনার প্যাকেটটি এখন ${place} এর পথে। 🚚`,
            `গন্তব্যের দিকে আরও এক ধাপ! ${place} এর ওয়্যারহাউজে যাচ্ছে আপনার শাড়ি। 🌬️`,
            `শহর থেকে শহরে, আপনার ভালোবাসা এখন ${place} এর দিকে।`,
            `দ্রুতগামী যানে চড়ে, আপনার পার্সেল এখন ${place} এর পথে। 🚛`
        ];
        return msgs[Math.floor(Math.random() * msgs.length)];
    }

    // 4. Received at Warehouse
    if (msg.includes('received at') && msg.includes('warehouse')) {
        const msgs = [
            "কিছুক্ষণ বিশ্রাম! ওয়্যারহাউজে নিরাপদে পৌঁছেছে আপনার প্যাকেট। 🏡",
            "সযত্নে রাখা আছে, শীঘ্রই আবার যাত্রা শুরু হবে আপনার ঠিকানায়। 💖",
            "মাঝপথের বিরতি। আপনার শাড়িটি এখন সুরক্ষিত আছে আমাদের হাবে। ✅",
            "ধুলোবালি থেকে দূরে, নিরাপদে পৌঁছে গেছে সর্টিং সেন্টারে। 🛡️"
        ];
        return msgs[Math.floor(Math.random() * msgs.length)];
    }

    // 5. Sent to Local Hub (In Transit to Customer Area)
    if (msg.includes('sent to') && !msg.includes('warehouse')) {
        const place = msg.split('sent to')[1].split('.')[0].trim();
        const msgs = [
            `অপেক্ষা আর মাত্র কিছু সময়ের, ${place} এর দিকে দ্রুত ছুটে চলছে। 🎀`,
            `দূরত্ব কমছে! আপনার শাড়িটি এখন ${place} এর খুব কাছে। ⚡`,
            `মন ভালো করা খবর! ${place} এর দিকে রওনা দিয়েছে আপনার পার্সেল। 🏎️`,
            `আর বেশি দেরি নেই, ${place} পৌঁছালেই আপনার দরজায় কড়া নাড়বে। 🔔`
        ];
        return msgs[Math.floor(Math.random() * msgs.length)];
    }

    // 6. Received at Local Hub (Arrived in City/Area)
    if (msg.includes('received at') && !msg.includes('warehouse')) {
        const place = msg.split('received at')[1].split('.')[0].trim();
        const msgs = [
            `শহরে স্বাগতম! আপনার প্যাকেটটি এখন ${place} এ পৌঁছে গেছে। 🏙️`,
            `আপনার খুব কাছেই! ${place} হাবে অপেক্ষা করছে আপনার ভালোবাসা। 💖`,
            `এইতো চলে এসেছি! ${place} এর বাতাসে এখন আপনার শাড়ির ঘ্রাণ। 🌸`,
            `আপনার এলাকার খুব কাছেই এখন! ${place} হাবে ল্যান্ড করেছে। 📍`
        ];
        return msgs[Math.floor(Math.random() * msgs.length)];
    }

    // 7. Assigned to Rider
    if (msg.includes('assigned by rider')) {
        const msgs = [
            "ফোনটি কাছে রাখুন আপু, রাইডার আপনার ঠিকানায় আসছেন সুখবর নিয়ে। 📞",
            "আজই সেই দিন! রাইডারের হাতে আপনার প্যাকেট, শীঘ্রই দেখা হবে। 🎁",
            "দরজায় কান পাতুন, আপনার শখের শাড়ি নিয়ে রাইডার আসছেন! 🛵",
            "হাতে পাওয়ার অপেক্ষা শেষ হতে চলল! রাইডার বেরিয়ে পড়েছেন। 📱"
        ];
        return msgs[Math.floor(Math.random() * msgs.length)];
    }

    // 8. Rider Note / Hold
    if (msg.includes('rider note') || msg.includes('hold')) {
        const msgs = [
            "একটু থামতে হলো, রাইডার একটি বার্তা দিয়েছেন। দয়া করে চেক করুন। 📝",
            "সামান্য বিলম্ব, কিন্তু চিন্তা করবেন না। আমরা খেয়াল রাখছি। 🌸",
            "রাইডার আপনাকে খুঁজে পাননি অথবা যোগাযোগ করতে চাইছেন। 👇",
            "একটি ছোট নোট আছে আপনার জন্য, নিচে দেখে নিন। 👀"
        ];
        return msgs[Math.floor(Math.random() * msgs.length)];
    }

    // 9. Delivered
    if (msg.includes('delivered')) {
        const msgs = [
            "অবশেষে আপনার হাতে! শাড়িটি পরে আপনাকে নিশ্চয়ই অপরূপ লাগবে। ছবি পাঠাতে ভুলবেন না! 📸✨",
            "আপনার মুখে হাসি ফোটানোটাই আমাদের সার্থকতা। অরণীর সাথে থাকার জন্য ধন্যবাদ। ❤️",
            "মিশন সফল! আশা করি নতুন শাড়িটি আপনার মন ভালো করে দেবে। 💙",
            "খুশির সংবাদ! ডেলিভারি সম্পন্ন হয়েছে। সুন্দর মুহূর্ত কাটুক অরণীর সাথে। 🎉"
        ];
        return msgs[Math.floor(Math.random() * msgs.length)];
    }

    return steadfastMsg; // Fallback to original text if no match
};

// 1. Render Track Page (GET - with Auto-Load if Link Provided)
exports.getTrackPage = async (req, res) => {
    try {
        const { id } = req.params; 
        const globalData = await getGlobalData(); 

        // A. If NO parameter -> Show empty search page
        if (!id) {
            return res.render('shop/pages/track_order', {
                title: 'Track Your Order',
                layout: 'shop/layout',
                prefillOrder: '',
                order: null,
                timeline: [],
                error: null,
                ...globalData
            });
        }

        // Clean the ID (handles things like ar-00001 or pure secrets)
        const cleanId = id.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

        // B. Fetch Order Immediately by Secret OR Order Number (No Phone Check)
        const [orders] = await db.query(`
            SELECT o.*, c.full_name, c.phone as cust_phone 
            FROM orders o 
            LEFT JOIN customers c ON o.customer_id = c.id
            WHERE o.tracking_secret = ? 
               OR UPPER(REPLACE(o.order_number, '-', '')) = ?
        `, [id, cleanId]);

        if (orders.length === 0) {
            // Invalid Link -> Show Error and form
            return res.render('shop/pages/track_order', {
                title: 'Track Your Order',
                layout: 'shop/layout',
                prefillOrder: id, // Prefill whatever they typed so they don't lose it
                order: null,
                timeline: [],
                error: 'Order not found. Invalid tracking link.',
                ...globalData
            });
        }

        const order = orders[0];

        // Block POS Orders gracefully
        if (order.order_source === 'pos') {
            return res.render('shop/pages/track_order', { 
                title: 'Track Order', 
                layout: 'shop/layout', 
                prefillOrder: order.order_number, 
                order: null, 
                timeline: [], 
                error: 'You bought this from in-store. No tracking ID is available for this purchase.',
                ...globalData
            });
        }

        // Generate a Secret Link if this is an old order that doesn't have one yet
        if (!order.tracking_secret) {
            const crypto = require('crypto');
            const secret = crypto.randomBytes(8).toString('hex');
            await db.query("UPDATE orders SET tracking_secret = ? WHERE id = ?", [secret, order.id]);
            order.tracking_secret = secret;
        }

        // C. Fetch Timeline
        const [rawTimeline] = await db.query("SELECT * FROM order_timelines WHERE order_id = ? ORDER BY timestamp DESC", [order.id]);

        const timeline = rawTimeline.map(t => ({
            original: t.message,
            vibe_msg: getVibeMessage(t.message), // Applies the new Bangla variations
            time: t.timestamp,
            rider_name: t.rider_name,
            rider_phone: t.rider_phone,
            is_rider_msg: (t.message || "").toLowerCase().includes('assigned by rider')
        }));

        // D. Render with Data instantly
        res.render('shop/pages/track_order', {
            title: 'Track Your Order',
            layout: 'shop/layout', 
            prefillOrder: order.order_number,
            order: { 
                ...order, 
                due_amount: (order.total_amount - order.paid_amount),
                secret_link: `${req.protocol}://${req.get('host')}/track/${order.tracking_secret}`
            },
            timeline,
            error: null,
            ...globalData
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
const db = require('../config/database');

// 1. ADMIN: Get Participants Page
exports.getParticipants = async (req, res) => {
    try {
        const [participants] = await db.query("SELECT * FROM gamification_participants ORDER BY created_at DESC");
        res.render('admin/gamification/participants', { participants, tab: 'participants' });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading participants");
    }
};

// 2. ADMIN: Get Settings Page (Placeholder for now)
exports.getSettings = async (req, res) => {
    res.render('admin/gamification/settings', { tab: 'settings' });
};

// 3. API: Get a Random Hiding Spot (Frontend calls this)
exports.getTargetUrl = async (req, res) => {
    try {
        // Logic: 20% Home, 20% Shop, 60% Random Product
        const rand = Math.random();
        
        if (rand < 0.2) {
            return res.json({ target: '/' });
        } else if (rand < 0.4) {
            return res.json({ target: '/shop' });
        } else {
            // Pick one random active product
            const [products] = await db.query("SELECT sku FROM products WHERE is_online='yes' ORDER BY RAND() LIMIT 1");
            if (products.length > 0) {
                return res.json({ target: '/product/' + products[0].sku });
            } else {
                return res.json({ target: '/shop' }); // Fallback
            }
        }
    } catch (err) {
        res.json({ target: '/' }); // Fallback on error
    }
};

// 4. API: Submit Winner
exports.submitWinner = async (req, res) => {
    try {
        const { name, phone, code } = req.body;

        // Clean phone
        const cleanPhone = phone.replace(/[^0-9]/g, '').slice(-11);

        // Check duplicate
        const [existing] = await db.query("SELECT id FROM gamification_participants WHERE phone = ?", [cleanPhone]);
        if (existing.length > 0) {
            return res.json({ success: false, message: "This phone number has already participated!" });
        }

        await db.query("INSERT INTO gamification_participants (name, phone, code) VALUES (?, ?, ?)", [name, cleanPhone, code]);
        
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.json({ success: false, message: "Server Error" });
    }
};
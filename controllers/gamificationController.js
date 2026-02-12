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

// 2. ADMIN: Get Settings Page
exports.getSettings = async (req, res) => {
    try {
        // Fetch current setting
        const [rows] = await db.query("SELECT * FROM gamification_settings WHERE id = 1");
        const settings = rows.length > 0 ? rows[0] : { is_active: 1 };
        
        res.render('admin/gamification/settings', { settings, tab: 'settings' });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading settings");
    }
};

// 3. ADMIN: Save Settings
exports.saveSettings = async (req, res) => {
    try {
        const is_active = req.body.is_active === 'on' ? 1 : 0;
        
        // Update or Insert (Upsert)
        const [rows] = await db.query("SELECT id FROM gamification_settings WHERE id = 1");
        if (rows.length === 0) {
            await db.query("INSERT INTO gamification_settings (id, is_active) VALUES (1, ?)", [is_active]);
        } else {
            await db.query("UPDATE gamification_settings SET is_active = ? WHERE id = 1", [is_active]);
        }

        res.redirect('/admin/gamification/settings?success=Settings Updated');
    } catch (err) {
        console.error(err);
        res.redirect('/admin/gamification/settings?error=Failed to save');
    }
};

// 4. API: Get a Random Hiding Spot (Frontend calls this)
exports.getTargetUrl = async (req, res) => {
    try {
        // [CHECK SETTINGS] First, check if the game is globally enabled
        const [settings] = await db.query("SELECT is_active FROM gamification_settings WHERE id = 1");
        if (settings.length === 0 || settings[0].is_active === 0) {
            return res.json({ target: null }); // Game is OFF
        }

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

// 5. API: Submit Winner
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
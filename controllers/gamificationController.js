const db = require('../config/database');

// 1. ADMIN: Dashboard & Participants
exports.getParticipants = async (req, res) => {
    try {
        // ১. বর্তমান একটিভ ক্যাম্পেইন বের করা
        const [activeCampaign] = await db.query("SELECT * FROM gamification_campaigns WHERE status = 'active' ORDER BY id DESC LIMIT 1");
        const currentCampaignId = activeCampaign.length > 0 ? activeCampaign[0].id : 0;

        // ২. বর্তমান পার্টিসিপেন্ট লিস্ট
        let currentParticipants = [];
        if (currentCampaignId) {
            [currentParticipants] = await db.query("SELECT * FROM gamification_participants WHERE campaign_id = ? ORDER BY created_at DESC", [currentCampaignId]);
        }

        // ৩. হিস্ট্রি (পূর্বের সব ক্যাম্পেইন)
        const [history] = await db.query(`
            SELECT c.*, p.name as winner_name, p.phone as winner_phone, p.code as winner_code 
            FROM gamification_campaigns c 
            LEFT JOIN gamification_participants p ON c.winner_id = p.id 
            WHERE c.status = 'completed' 
            ORDER BY c.end_date DESC
        `);

        // ৪. সেটিংস স্ট্যাটাস
        const [settings] = await db.query("SELECT is_active FROM gamification_settings WHERE id = 1");
        const isActive = settings.length > 0 ? settings[0].is_active : 0;

        res.render('admin/gamification/participants', { 
            currentParticipants, 
            history, 
            activeCampaign: activeCampaign[0] || null,
            isActive,
            tab: 'participants' 
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error loading data");
    }
};

// 2. ADMIN: Toggle Campaign Status (ON/OFF)
exports.toggleStatus = async (req, res) => {
    try {
        const isTurningOn = req.body.is_active === 'on';
        
        if (isTurningOn) {
            // যদি অন করা হয়, চেক করি কোনো একটিভ ক্যাম্পেইন আছে কিনা
            const [existing] = await db.query("SELECT id FROM gamification_campaigns WHERE status = 'active'");
            
            if (existing.length === 0) {
                // কোনো একটিভ ক্যাম্পেইন নেই, তাই নতুন ক্যাম্পেইন (ID: 1, 2, 3...) তৈরি করি
                const [result] = await db.query("INSERT INTO gamification_campaigns (start_date, status) VALUES (NOW(), 'active')");
                
                // গ্লোবাল সেটিংসেও আপডেট করি
                await db.query("UPDATE gamification_settings SET is_active = 1, current_campaign_id = ? WHERE id = 1", [result.insertId]);
            } else {
                // ইতিমধ্যে একটিভ আছে, শুধু গ্লোবাল সুইচ অন করি
                await db.query("UPDATE gamification_settings SET is_active = 1 WHERE id = 1");
            }
        } else {
            // যদি অফ করা হয়, শুধু গ্লোবাল সুইচ অফ করি (ক্যাম্পেইন শেষ হবে না, শুধু পজ হবে)
            await db.query("UPDATE gamification_settings SET is_active = 0 WHERE id = 1");
        }

        res.redirect('/admin/gamification/participants');
    } catch (err) {
        console.error(err);
        res.status(500).send("Error updating status");
    }
};

// 3. ADMIN: Draw Winner
exports.drawWinner = async (req, res) => {
    try {
        // ১. বর্তমান ক্যাম্পেইন বের করি
        const [campaigns] = await db.query("SELECT id FROM gamification_campaigns WHERE status = 'active' LIMIT 1");
        if (campaigns.length === 0) return res.status(400).json({ success: false, message: "No active campaign" });
        
        const campaignId = campaigns[0].id;

        // ২. র‍্যান্ডম উইনার সিলেক্ট করি
        const [participants] = await db.query("SELECT id, name, code FROM gamification_participants WHERE campaign_id = ?", [campaignId]);
        
        if (participants.length === 0) {
            await db.query("UPDATE gamification_campaigns SET status = 'completed', end_date = NOW() WHERE id = ?", [campaignId]);
            await db.query("UPDATE gamification_settings SET is_active = 0 WHERE id = 1");
            return res.json({ success: false, message: "No participants found" });
        }

        const randomIndex = Math.floor(Math.random() * participants.length);
        const winner = participants[randomIndex]; // উইনার অবজেক্ট

        // ৩. আপডেট: উইনার সেট করা
        await db.query("UPDATE gamification_participants SET is_winner = 1 WHERE id = ?", [winner.id]);
        
        await db.query(`
            UPDATE gamification_campaigns 
            SET winner_id = ?, status = 'completed', end_date = NOW(), total_participants = ? 
            WHERE id = ?
        `, [winner.id, participants.length, campaignId]);

        // ৪. অটোমেটিক সিস্টেম অফ করা
        await db.query("UPDATE gamification_settings SET is_active = 0 WHERE id = 1");

        // [CHANGE] Redirect এর বদলে JSON পাঠানো হচ্ছে
        res.json({ success: true, winnerName: winner.name, winnerCode: winner.code });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Server Error" });
    }
};

// 4. API: Get History Details (For Modal)
exports.getHistoryDetails = async (req, res) => {
    try {
        const campaignId = req.params.id;
        const [participants] = await db.query(`
            SELECT * FROM gamification_participants 
            WHERE campaign_id = ? 
            ORDER BY is_winner DESC, created_at DESC
        `, [campaignId]); // is_winner DESC keeps winner on top

        res.json({ participants });
    } catch (err) {
        res.status(500).json({ error: "Error fetching details" });
    }
};

// 5. API: Get Target (Frontend)
exports.getTargetUrl = async (req, res) => {
    try {
        const [settings] = await db.query("SELECT is_active FROM gamification_settings WHERE id = 1");
        if (settings.length === 0 || settings[0].is_active === 0) {
            return res.json({ target: null });
        }

        const rand = Math.random();
        if (rand < 0.2) return res.json({ target: '/' });
        else if (rand < 0.4) return res.json({ target: '/shop' });
        else {
            // [UPDATE] Target only products that are Online AND (In Stock OR Preorder Enabled)
            const [products] = await db.query("SELECT sku FROM products WHERE is_online='yes' AND (stock_quantity > 0 OR is_preorder = 'yes') ORDER BY RAND() LIMIT 1");
            return res.json({ target: products.length > 0 ? '/product/' + products[0].sku : '/shop' });
        }
    } catch (err) {
        res.json({ target: '/' });
    }
};

// 6. API: Submit Participant (Frontend)
exports.submitWinner = async (req, res) => {
    try {
        const { name, phone, code } = req.body;
        const cleanPhone = phone.replace(/[^0-9]/g, '').slice(-11);

        // বর্তমান ক্যাম্পেইন আইডি নেওয়া
        const [settings] = await db.query("SELECT current_campaign_id, is_active FROM gamification_settings WHERE id = 1");
        if (settings.length === 0 || !settings[0].is_active) {
            return res.json({ success: false, message: "Campaign is currently inactive." });
        }
        const campaignId = settings[0].current_campaign_id;

        // ডুপ্লিকেট চেক
        const [existing] = await db.query("SELECT id FROM gamification_participants WHERE phone = ? AND campaign_id = ?", [cleanPhone, campaignId]);
        if (existing.length > 0) {
            return res.json({ success: false, message: "This number already participated in this campaign!" });
        }

        // ১. পার্টিসিপেন্ট সেভ করা
        await db.query("INSERT INTO gamification_participants (name, phone, code, campaign_id) VALUES (?, ?, ?, ?)", [name, cleanPhone, code, campaignId]);

        // ২. [NEW] কাস্টমার টেবিলে সেভ করা (যদি না থাকে)
        // আমরা INSERT IGNORE ব্যবহার করছি যাতে ফোন নাম্বার ডুপ্লিকেট হলে এরর না দেয়
        // অথবা চেক করে ইনসার্ট করতে পারি
        const [custCheck] = await db.query("SELECT id FROM customers WHERE phone = ?", [cleanPhone]);
        if (custCheck.length === 0) {
            // কাস্টমার নেই, নতুন তৈরি করি
            await db.query("INSERT INTO customers (full_name, phone) VALUES (?, ?)", [name, cleanPhone]);
        }

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.json({ success: false, message: "Server Error" });
    }
};
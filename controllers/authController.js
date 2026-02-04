const db = require('../config/database');
const bcrypt = require('bcryptjs');

// Show Login Page
exports.getLoginPage = (req, res) => {
    if (req.session.user) {
        return res.redirect('/admin/dashboard');
    }
    // FIX: Added layout: false to prevent loading sidebar
    res.render('admin/login', { error: null, layout: false });
};

// Handle Login Submission
exports.login = async (req, res) => {
    try {
        const { login_id, password } = req.body;

        // Check against Email OR Phone OR User ID
        const query = "SELECT * FROM users WHERE email = ? OR phone = ? OR user_id = ?";
        const [users] = await db.query(query, [login_id, login_id, login_id]);
        
        if (users.length === 0) {
            // FIX: Added layout: false
            return res.render('admin/login', { error: 'User not found', layout: false });
        }

        const user = users[0];
        // Verify Password
        const match = await bcrypt.compare(password, user.password);

        if (match) {
            // --- CHANGE START: Parse Permissions ---
            let permissions = {};
            try {
                // If permissions exist in DB, parse them. If null, use empty object.
                permissions = user.permissions ? JSON.parse(user.permissions) : {};
            } catch (e) {
                permissions = {}; // Fallback if JSON is broken
            }

            // Set Session with Permissions
            req.session.user = {
                id: user.id,
                name: user.name,
                user_id: user.user_id,
                role: user.role,
                permissions: permissions // <--- Added This
            };
            // --- CHANGE END ---

            req.session.save(() => {
                res.redirect('/admin/dashboard');
            });
        } else {
            // FIX: Added layout: false
            res.render('admin/login', { error: 'Incorrect password', layout: false });
        }
    } catch (err) {
        console.error(err);
        // FIX: Added layout: false
        res.render('admin/login', { error: 'System error', layout: false });
    }
};

// Handle Logout
exports.logout = (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
};

// --- NEW: Middleware to Protect Routes ---
exports.isLoggedIn = (req, res, next) => {
    if (req.session && req.session.user) {
        return next();
    }
    res.redirect('/admin/login');
};

// --- NEW: Change Own Password (AJAX) ---
exports.changeOwnPassword = async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { currentPassword, newPassword } = req.body;
    const userId = req.session.user.id;

    try {
        // 1. Fetch User's Current Password Hash
        const [users] = await db.query('SELECT password FROM users WHERE id = ?', [userId]);
        if (users.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const user = users[0];

        // 2. Verify Current Password
        const match = await bcrypt.compare(currentPassword, user.password);
        if (!match) {
            return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
        }

        // 3. Hash New Password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // 4. Update Database
        await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId]);

        res.json({ success: true, message: 'Password updated successfully!' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};
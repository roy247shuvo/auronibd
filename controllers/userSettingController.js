const db = require('../config/database');
const bcrypt = require('bcryptjs');

// --- DETAILED PERMISSION MAP (Based on your Sidebar) ---
const MODULE_TREE = {
    dashboard: {
        label: 'Dashboard',
        items: { dashboard_view: 'Access Dashboard' }
    },
    pos: {
        label: 'POS System',
        items: {
            pos_terminal: 'POS Terminal',
            pos_history: 'Sale History',
            pos_setting: 'POS Settings'
        }
    },
    orders: {
        label: 'Orders',
        items: {
            orders_web: 'Web Orders',
            orders_return: 'Partial Returns',
            orders_label: 'Label Settings'
        }
    },
    products: {
        label: 'Products & Inventory',
        items: {
            prod_inventory: 'Inventory List',
            prod_collections: 'Collections',
            prod_po: 'Purchase Orders',
            prod_settings: 'Product Settings'
        }
    },
    customers: {
        label: 'Customers & Vendors',
        items: {
            cust_list: 'Customers List',
            vend_list: 'Vendors List'
        }
    },
    campaigns: {
        label: 'Marketing Campaigns',
        items: {
            camp_sms: 'SMS Campaigns',
            camp_meta: 'Meta Campaigns',
            camp_subs: 'Subscribers'
        }
    },
    discounts: {
        label: 'Discounts',
        items: {
            disc_coupons: 'Coupons',
            disc_credits: 'Store Credits'
        }
    },
    website: {
        label: 'Website Builder',
        items: {
            web_elements: 'Elements/Banners',
            web_checkout: 'Checkout Options',
            web_notif: 'SMS/Email Notifications'
        }
    },
    accounts: {
        label: 'Accounts & Finance',
        items: {
            acc_overview: 'Overview',
            acc_transfers: 'Transfers',
            acc_sales: 'Sales Data',
            acc_expenses: 'Expenses',
            acc_reports: 'P/L & Balance Sheet',
            acc_settings: 'Account Settings'
        }
    },
    settings: {
        label: 'Global Settings',
        items: {
            set_general: 'General & Courier',
            set_store: 'Store Details',
            set_users: 'Users & Roles',
            set_smtp: 'SMTP & Analytics'
        }
    }
};

// 1. List Users
exports.getUsers = async (req, res) => {
    try {
        const [users] = await db.query("SELECT * FROM users ORDER BY created_at DESC");
        res.render('admin/settings/users_index', {
            title: 'Users',
            layout: 'admin/layout',
            users: users
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

// 2. Add User Form
exports.getAddUser = (req, res) => {
    res.render('admin/settings/users_form', {
        title: 'Add New User',
        layout: 'admin/layout',
        user: null, // No user data = Add Mode
        modules: MODULE_TREE
    });
};

// 3. Edit User Form
exports.getEditUser = async (req, res) => {
    try {
        const [users] = await db.query("SELECT * FROM users WHERE id = ?", [req.params.id]);
        if (users.length === 0) return res.redirect('/admin/settings/users');

        let user = users[0];
        try {
            user.permissions = user.permissions ? JSON.parse(user.permissions) : {};
        } catch (e) {
            user.permissions = {};
        }

        res.render('admin/settings/users_form', {
            title: 'Edit User',
            layout: 'admin/layout',
            user: user,
            modules: MODULE_TREE
        });
    } catch (err) {
        console.error(err);
        res.redirect('/admin/settings/users');
    }
};

// 4. Save User
exports.saveUser = async (req, res) => {
    try {
        const { user_id, full_name, email, password, role, phone } = req.body;
        
        // Collect Permissions (perms[pos_terminal] = 'write')
        const perms = req.body.perms || {};
        const permissionsJSON = JSON.stringify(perms);

        if (user_id) {
            // Update
            let query = "UPDATE users SET name=?, email=?, role=?, phone=?, permissions=? WHERE id=?";
            let params = [full_name, email, role, phone, permissionsJSON, user_id];

            if (password && password.trim() !== "") {
                const hashedPassword = await bcrypt.hash(password, 10);
                query = "UPDATE users SET name=?, email=?, role=?, phone=?, permissions=?, password=? WHERE id=?";
                params = [full_name, email, role, phone, permissionsJSON, hashedPassword, user_id];
            }
            await db.query(query, params);
        } else {
            // Insert
            if (!password) return res.redirect('/admin/settings/users/add?error=Password required');
            const hashedPassword = await bcrypt.hash(password, 10);
            const handle = 'U-' + Date.now().toString().slice(-6);
            
            await db.query(
                "INSERT INTO users (user_id, name, email, password, role, phone, permissions) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [handle, full_name, email, hashedPassword, role, phone, permissionsJSON]
            );
        }
        res.redirect('/admin/settings/users?success=Saved Successfully');
    } catch (err) {
        console.error(err);
        res.redirect('/admin/settings/users/add?error=Database Error');
    }
};
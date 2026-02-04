const db = require('../config/database');
const metaService = require('../config/metaService');

// --- HELPER: Save Session Safely ---
// This ensures the database session is written BEFORE sending the response
const setSessionAndRespond = (req, res, customer, message) => {
    req.session.customer = {
        id: customer.id,
        // [FIX] Ensure full_name is explicitly saved for the view
        full_name: customer.full_name || customer.name || 'Customer',
        name: customer.full_name || customer.name || 'Customer',
        email: customer.email,
        phone: customer.phone,
        photo_url: customer.photo_url
    };
    
    req.session.save((err) => {
        if (err) {
            console.error("Session Save Error:", err);
            return res.status(500).json({ status: 'error', message: 'Login session failed. Please try again.' });
        }
        res.json({ status: 'success', message });
    });
};

// 1. STAGE 1: Check Google Email
exports.googleLogin = async (req, res) => {
    try {
        const { email, uid, photoURL } = req.body;

        // Check if email exists
        const [customers] = await db.query("SELECT * FROM customers WHERE email = ?", [email]);

        if (customers.length > 0) {
            // FOUND: Login immediately
            const customer = customers[0];
            
            // Update Google UID/Photo if missing
            if (!customer.google_uid || !customer.photo_url) {
                await db.query("UPDATE customers SET google_uid = ?, photo_url = ? WHERE id = ?", [uid, photoURL, customer.id]);
                // Update local object for session
                customer.photo_url = photoURL;
            }

            // [TRACKING] Fire 'Login' Event
            metaService.sendEvent('Login', {
                email: customer.email,
                phone: customer.phone,
                first_name: customer.name,
                custom_data: { method: 'Google' }
            }, req);

            // Save Session & Return
            return setSessionAndRespond(req, res, customer, 'Logged in successfully');
        } else {
            // NOT FOUND: Ask for phone number
            return res.json({ status: 'needs_phone', message: 'Email not found, please verify phone' });
        }
    } catch (err) {
        console.error("Google Login Error:", err);
        res.status(500).json({ status: 'error', message: 'Server error during login' });
    }
};

// 2. STAGE 2: Check Phone Number (Updated with Email Conflict Check)
exports.verifyPhone = async (req, res) => {
    try {
        const { phone } = req.body;
        const cleanPhone = phone.replace(/[^0-9]/g, '').slice(-11);

        // Fetch user by phone
        const [customers] = await db.query("SELECT * FROM customers WHERE phone = ?", [cleanPhone]);

        if (customers.length > 0) {
            const customer = customers[0];

            // [NEW LOGIC] Check if this phone ALREADY has a different email linked
            if (customer.email && customer.email.length > 0) {
                
                // 1. Helper to mask email (e.g., "shub***@gmail.com")
                const maskEmail = (email) => {
                    const [name, domain] = email.split('@');
                    if (name.length <= 2) return `${name}***@${domain}`;
                    return `${name.slice(0, 2)}***${name.slice(-1)}@${domain}`;
                };

                return res.json({
                    status: 'conflict', // New Status
                    masked_email: maskEmail(customer.email),
                    message: 'Phone number already linked to another email'
                });
            }

            // If no email exists, proceed to Link Account
            return res.json({ 
                status: 'found', 
                customer: {
                    name: customer.full_name || customer.name, // Handle both for safety
                    address: customer.address || 'No address saved',
                    city: customer.city
                }
            });

        } else {
            // Brand new customer -> Create Account
            return res.json({ status: 'new_customer' });
        }
    } catch (err) {
        console.error("Verify Phone Error:", err);
        res.status(500).json({ status: 'error', message: 'Server error checking phone' });
    }
};

// 3. STAGE 3A: Link Existing Customer (Phone Match)
exports.linkCustomer = async (req, res) => {
    try {
        const { email, uid, photoURL, phone } = req.body;
        const cleanPhone = phone.replace(/[^0-9]/g, '').slice(-11);

        // Update the existing customer row
        await db.query(`
            UPDATE customers 
            SET email = ?, google_uid = ?, photo_url = ? 
            WHERE phone = ?
        `, [email, uid, photoURL, cleanPhone]);

        // Fetch updated data for session
        const [updated] = await db.query("SELECT * FROM customers WHERE phone = ?", [cleanPhone]);
        const customer = updated[0];

        // [TRACKING] Fire 'Login' Event
        metaService.sendEvent('Login', {
            email: customer.email,
            phone: customer.phone,
            first_name: customer.name,
            custom_data: { method: 'Google Link' }
        }, req);

        setSessionAndRespond(req, res, customer, 'Account linked successfully');
    } catch (err) {
        console.error("Link Customer Error:", err);
        res.status(500).json({ status: 'error', message: 'Failed to link account' });
    }
};

// 4. STAGE 3B: Create New Customer (No Match)
exports.createCustomer = async (req, res) => {
    try {
        const { email, uid, photoURL, phone, name } = req.body;
        const cleanPhone = phone.replace(/[^0-9]/g, '').slice(-11);
        const customerName = name || 'Customer'; 

        // [FIX] Changed 'name' to 'full_name' in query
        const [result] = await db.query(`
            INSERT INTO customers (full_name, phone, email, google_uid, photo_url)
            VALUES (?, ?, ?, ?, ?)
        `, [customerName, cleanPhone, email, uid, photoURL]);

        const newCustomer = {
            id: result.insertId,
            full_name: customerName,
            email: email,
            phone: cleanPhone,
            photo_url: photoURL
        };

        // [TRACKING] Fire 'CompleteRegistration' AND 'Login'
        metaService.sendEvent('CompleteRegistration', {
            email: email,
            phone: cleanPhone,
            first_name: customerName,
            custom_data: { method: 'Google Signup' }
        }, req);

        metaService.sendEvent('Login', {
            email: email,
            phone: cleanPhone,
            first_name: customerName
        }, req);

        setSessionAndRespond(req, res, newCustomer, 'Account created successfully');
    } catch (err) {
        console.error("Create Customer Error:", err);
        res.status(500).json({ status: 'error', message: 'Failed to create account: ' + err.message });
    }
};

// 5. Logout
exports.logout = (req, res) => {
    req.session.destroy((err) => {
        if (err) console.error("Logout Error:", err);
        res.redirect('/');
    });
};
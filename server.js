require('dotenv').config();
const express = require('express');
const session = require('express-session');
// [NEW FIX] We must extract RedisStore using curly brackets in v9!
const { RedisStore } = require('connect-redis'); 
const { createClient } = require('redis');
const expressLayouts = require('express-ejs-layouts');
const db = require('./config/database'); 

// 1. Initialize Redis Client
const redisClient = createClient({ url: 'redis://127.0.0.1:6379' });
redisClient.on('error', (err) => console.log('Redis Client Error', err));
redisClient.connect().catch(console.error);
const dashboardController = require('./controllers/dashboardController');
// [REMOVED] request-ip and geoip-lite imports (Moved to controller)

// --- SECURITY IMPORTS ---
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');

// 1. INITIALIZE APP FIRST (Must be here)
const app = express();

// 2. NOW SET TRUST PROXY (Immediately after app is created)
app.set('trust proxy', 1);

// --- PERFORMANCE MIDDLEWARE ---
app.use(compression());

// --- SECURITY MIDDLEWARE ---
// 1. Helmet (Security Headers)
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginOpenerPolicy: false, // <--- ALLOWS GOOGLE POPUP TO WORK
}));

// 2. Rate Limiter (Prevent Brute Force)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // Limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again after 15 minutes",
  standardHeaders: true, 
  legacyHeaders: false,
  // [NEW] Skip rate limiting for the Admin Panel
  skip: (req, res) => {
      return req.path.startsWith('/admin');
  }
});
app.use(limiter);

// 3. Session Setup (Using classic connect-redis initialization)
const sessionStore = new RedisStore({
    client: redisClient,
    prefix: "auroni:",
});

app.use(session({
    key: 'auroni_session', // Renamed for clarity
    secret: process.env.SESSION_SECRET,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 1000 * 60 * 60 * 24,
        httpOnly: true,
        // Recommended: Set secure: true if you are using HTTPS
        // secure: process.env.NODE_ENV === 'production' 
    } 
}));

// --- AUTO-REFRESH PERMISSIONS MIDDLEWARE ---
// This forces the app to fetch the latest permissions from DB on every page load
app.use(async (req, res, next) => {
    if (req.session.user && req.session.user.id) {
        try {
            const db = require('./config/database'); // Ensure DB is imported
            // === FIX: Select 'name' too ===
            const [users] = await db.query('SELECT name, role, permissions FROM users WHERE id = ?', [req.session.user.id]);
            
            if (users.length > 0) {
                req.session.user.role = users[0].role;
                req.session.user.permissions = users[0].permissions ? JSON.parse(users[0].permissions) : [];
                
                // === FIX: Update session name from DB ===
                req.session.user.username = users[0].name; 
                
                req.session.save();
            }
            
            if (users.length > 0) {
                // Overwrite the session data with fresh data from DB
                req.session.user.role = users[0].role;
                req.session.user.permissions = users[0].permissions ? JSON.parse(users[0].permissions) : [];
                
                // Force save to memory (optional but safe)
                req.session.save();
            }
        } catch (err) {
            console.error("Error refreshing permissions:", err);
        }
    }
    // Make user available to all views
    res.locals.user = req.session.user || null;
    next();
});
// -------------------------------------------

app.use(express.urlencoded({ extended: true }));
app.use(express.json()); 

// === NEW: Webhook Route (MUST be before CSRF) ===
// We use the order controller which we will update later
const orderController = require('./controllers/orderController');
app.post('/api/steadfast/webhook', orderController.handleWebhook); 

// --- CSRF PROTECTION START ---
const csrf = require('csurf');
const csrfProtection = csrf();

// Enable CSRF
app.use(csrfProtection);

// Global Middleware
app.use(async (req, res, next) => {
    res.locals.csrfToken = req.csrfToken();
    
    // --- [NEW] PERMISSION HELPER & GLOBAL USER ---
    const currentUser = req.session.user || null;
    res.locals.user = currentUser;

    // Helper: can('module', 'read' | 'write')
    // Usage in EJS: <% if (can('products', 'write')) { %> ... <% } %>
    res.locals.can = (module, requiredLevel = 'read') => {
        if (!currentUser) return false;
        
        // 1. Only 'admin' has full access
        if (currentUser.role === 'admin') return true;
        
        // 2. Check User Permissions
        const userPerms = currentUser.permissions || {};
        const userLevel = userPerms[module] || 'none';
        
        if (userLevel === 'none') return false;
        if (requiredLevel === 'write' && userLevel === 'read') return false;
        
        return true;
    };
    // ---------------------------------------------
    
    // [1] PASS CUSTOMER TO VIEW (Crucial for Header)
    res.locals.customer = req.session.customer || null;
    
    // [FIX] Fallback for full_name if missing in session (Backwards Compatibility)
    if (res.locals.customer && !res.locals.customer.full_name && res.locals.customer.name) {
        res.locals.customer.full_name = res.locals.customer.name;
    }

    // [2] FETCH ALL SETTINGS (Crucial for Firebase/Meta)
    try {
        const [settings] = await db.query("SELECT * FROM shop_settings LIMIT 1");
        res.locals.shopSettings = settings.length ? settings[0] : {};
    } catch(e) {
        res.locals.shopSettings = {};
    }
    
    next();
});

// 2. View Engine & Assets
app.use(express.static('public', {
    maxAge: '365d', // Increased to 1 year to pass audit
    etag: true      // Helps browser validate if file changed
}));
app.use(expressLayouts);
app.set('view engine', 'ejs');
app.set('layout', 'admin/layout');
// <--- ADD THIS LINE HERE

// 3. Route Imports
const productRoutes = require('./routes/productRoutes');
const productSettingRoutes = require('./routes/productSettingRoutes');
const authRoutes = require('./routes/authRoutes');

// === AUTH MIDDLEWARE ===
const requireAuth = (req, res, next) => {
    // Allow login and public files
    if (req.path === '/login' || req.path.startsWith('/public')) {
        return next();
    }
    
    // Check if user is logged in
    if (req.session && req.session.user) {
        next();
    } else {
        res.redirect('/login');
    }
};



// 4. Routes Configuration

// A. Public Routes
app.use('/', authRoutes); // Login/Logout
app.use('/', require('./routes/shopRoutes'));
app.use('/', require('./routes/trackingRoutes'));
app.use('/', require('./routes/searchRoutes'));
app.use('/admin/website', require('./routes/websiteRoutes')); // <--- Admin Website Routes
app.use('/', require('./routes/gamificationRoutes')); // [NEW] Gamification

// B. Protect all /admin routes
app.use('/admin', requireAuth);

// C. Admin Modules
app.use('/admin/products', productRoutes);
app.use('/admin/products', productSettingRoutes);
app.use('/admin/media', require('./routes/mediaRoutes'));
app.use('/admin/collections', require('./routes/collectionRoutes'));
app.use('/admin/orders', require('./routes/orderRoutes'));
app.use('/admin/settings', require('./routes/adminSettingRoutes'));
app.use('/admin/accounts', require('./routes/accountRoutes'));
app.use('/admin/vendors', require('./routes/vendorRoutes'));
app.use('/admin/purchase-orders', require('./routes/purchaseOrderRoutes'));
app.use('/admin/production', require('./routes/productionRoutes'));
app.use('/admin/pos', require('./routes/posRoutes'));
app.use('/admin/customers', require('./routes/customerRoutes'));
app.use('/admin/campaigns', require('./routes/campaignRoutes'));
app.use('/admin/discounts', require('./routes/discountRoutes'));
app.get('/admin/dashboard', requireAuth, dashboardController.getDashboard);
app.get('/admin/api/live-stats', requireAuth, dashboardController.getLiveStats);

// [NEW] Advanced Redis Visitor Tracking (with Location for Map)
app.use(async (req, res, next) => {
    // Skip tracking for admin pages to keep the map clean
    if (req.path.startsWith('/admin')) return next();

    try {
        // Prepare the data for the map (Reading headers from Cloudflare/Webuzo)
        const visitorData = {
            city: req.headers['x-vercel-ip-city'] || 'Customer', 
            lat: parseFloat(req.headers['x-vercel-ip-latitude']) || 23.8103, // Default to Dhaka
            lng: parseFloat(req.headers['x-vercel-ip-longitude']) || 90.4125
        };
        
        // Save to Redis for 120 seconds. Redis handles the "DELETE" automatically!
        await redisClient.set(`active_visitor:${req.ip}`, JSON.stringify(visitorData), { EX: 120 });
    } catch (e) {
        console.log("Redis Tracking error:", e.message);
    }
    next();
});

// === AUTOMATIC ZOMBIE KILLER (Runs every 10 minutes) ===
// This releases stock automatically even if NO ONE logs into the POS.
// Example: Crash at 6:00 PM -> This job detects it around 8:00 PM and frees stock.
setInterval(async () => {
    try {
        const [zombies] = await db.query("SELECT * FROM pos_holds WHERE created_at < (NOW() - INTERVAL 2 HOUR)");
        
        if (zombies.length > 0) {
            console.log(`[${new Date().toLocaleString()}] Ã°Å¸â€˜Â» Found ${zombies.length} expired holds. Releasing stock...`);
            for (const z of zombies) {
                // 1. Restore Variant Stock
                await db.query("UPDATE product_variants SET stock_quantity = stock_quantity + ? WHERE id = ?", [z.quantity, z.variant_id]);
                // 2. Restore Main Product Stock
                await db.query("UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?", [z.quantity, z.product_id]);
            }
            // 3. Delete the zombies
            await db.query("DELETE FROM pos_holds WHERE created_at < (NOW() - INTERVAL 2 HOUR)");
        }
    } catch (err) {
        console.error("Error in Auto-Cleanup:", err);
    }
}, 10 * 60 * 1000); // Check every 10 Minutes

// === DAILY UNIVERSAL HISTORY CLEANER (Runs every 24 hours) ===
// Logic: For ANY finalized order (Delivered, Cancelled, Returned, etc.) older than 30 days:
// 1. Keep the VERY LAST timeline entry (The final status/proof).
// 2. Delete all previous history steps (The journey).
setInterval(async () => {
    try {
        const retentionDays = 30;
        console.log(`[${new Date().toLocaleString()}] 🧹 Running Universal History Cleanup...`);

        // 1. Identify Finalized Orders (Modify this list if you have other status names)
        const finalStatuses = ['delivered', 'cancelled', 'Partially_Delivered', 'Pending_return', 'returned'];
        
        // 2. The Smart Delete Query
        // It deletes from 'order_timelines' (ot)
        // BUT it excludes the row with the MAX ID (the latest one) for that order.
        await db.query(`
            DELETE ot
            FROM order_timelines ot
            JOIN orders o ON ot.order_id = o.id
            WHERE o.status IN (?) 
            AND ot.timestamp < (NOW() - INTERVAL ? DAY)
            AND ot.id != (
                SELECT max_id FROM (
                    SELECT MAX(id) as max_id 
                    FROM order_timelines 
                    WHERE order_id = ot.order_id
                ) as safe_keep
            )
        `, [finalStatuses, retentionDays]);

        console.log(`[${new Date().toLocaleString()}] 🧹 Cleanup check complete.`);

    } catch (err) {
        console.error("Error in History Cleanup:", err);
    }
}, 24 * 60 * 60 * 1000); // Check every 24 Hours

// === BACKUP STATUS SYNC (Runs every 30 Minutes) ===
// If webhook fails, this manually checks Steadfast for status updates.
setInterval(async () => {
    try {
        await orderController.syncSteadfastStatus();
    } catch (err) {
        console.error("Error in Backup Sync:", err);
    }
}, 30 * 60 * 1000);

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    const time = new Date().toLocaleString();
    console.log(`[${time}] Server running on port ${PORT}`);
});
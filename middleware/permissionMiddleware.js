// middleware/permissionMiddleware.js

/**
 * Check Permission Middleware
 * @param {string} module - The menu key (e.g., 'orders', 'pos')
 */
const checkPermission = (module) => {
    return (req, res, next) => {
        // 1. Only 'admin' (Super Admin) bypasses checks. Owners are now checked like users.
        if (req.session.user && req.session.user.role === 'admin') {
            return next();
        }

        // 2. Check if user exists and has permissions
        const userPerms = req.session.user ? req.session.user.permissions : null;
        
        if (!userPerms) {
            // No permissions found? Redirect to dashboard or show error
            return res.status(403).send('Access Denied: No permissions assigned.');
        }

        // 3. Get permission level for this specific module
        // levels: 'none', 'read', 'write'
        const permissionLevel = userPerms[module] || 'none';

        if (permissionLevel === 'none') {
             // AJAX request? Send JSON error. Regular request? Show page.
             if (req.xhr || req.headers.accept.indexOf('json') > -1) {
                return res.status(403).json({ error: 'Access Denied' });
             }
             return res.redirect('/admin/dashboard?error=Access Denied');
        }

        // 4. If trying to WRITE (POST/PUT/DELETE) but only has READ access
        if (req.method !== 'GET' && permissionLevel === 'read') {
            if (req.xhr || req.headers.accept.indexOf('json') > -1) {
                return res.status(403).json({ error: 'View Only Access' });
            }
            return res.status(403).send('You have View Only access to this module.');
        }

        // 5. Access Granted
        next();
    };
};

module.exports = checkPermission;
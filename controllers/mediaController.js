const db = require('../config/database');

exports.uploadImage = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const url = req.file.path;
        const context = req.query.context || 'product'; // Get context from URL

        // Save with context
        await db.query("INSERT INTO media (image_url, context) VALUES (?, ?)", [url, context]);

        res.json({ success: true, url: url });
    } catch (error) {
        console.error("Upload Error:", error);
        res.status(500).json({ error: 'Upload failed' });
    }
};

// NEW: Local Upload Handler
exports.uploadLocalImage = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const url = '/uploads/' + req.file.filename; // Relative path
        const context = req.query.context || 'logo';

        // Save to DB
        await db.query("INSERT INTO media (image_url, context) VALUES (?, ?)", [url, context]);

        res.json({ success: true, url: url });
    } catch (error) {
        console.error("Local Upload Error:", error);
        res.status(500).json({ error: 'Upload failed' });
    }
};

exports.getLibrary = async (req, res) => {
    try {
        const context = req.query.context || 'product';
        
        // Filter by context (Show only banners if context=banner, else show products)
        const [images] = await db.query(
            "SELECT * FROM media WHERE context = ? ORDER BY created_at DESC LIMIT 50", 
            [context]
        );
        
        res.json({ success: true, images: images });
    } catch (error) {
        res.status(500).json({ error: 'Fetch failed' });
    }
};
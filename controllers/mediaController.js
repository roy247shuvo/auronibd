const db = require('../config/database');

exports.uploadImage = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const url = req.file.path; // Cloudinary URL
        const context = req.query.context || 'product';
        
        // We calculate type for the frontend response, but we don't save it to DB
        const type = req.file.mimetype.startsWith('video') ? 'video' : 'image';

        // Save to Media Library DB (Removed 'media_type' column)
        await db.query("INSERT INTO media (image_url, context) VALUES (?, ?)", [url, context]);

        // Return Standard JSON
        res.json({ success: true, url: url, type: type });
    } catch (error) {
        console.error("Upload Error:", error);
        res.status(500).json({ error: error.message || 'Upload failed' });
    }
};

exports.getLibrary = async (req, res) => {
    try {
        const context = req.query.context || 'product';
        // Fetch last 50 items for this context
        const [images] = await db.query(
            "SELECT * FROM media WHERE context = ? ORDER BY created_at DESC LIMIT 50", 
            [context]
        );
        res.json({ success: true, images: images });
    } catch (error) {
        res.status(500).json({ error: 'Fetch failed' });
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
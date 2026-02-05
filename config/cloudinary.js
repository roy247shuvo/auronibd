const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// --- SAFETY CHECK ---
if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY) {
    console.error("❌ CRITICAL: Cloudinary credentials are missing in .env file!");
}

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: async (req, file) => {
        // 1. Determine Context (passed via Query: ?context=banner)
        const context = req.query.context || 'product';
        
        // 2. Define Folder & Settings based on Context
        let folderName = 'auroni_products';
        let widthLimit = 1000;

        if (context === 'banner') {
            folderName = 'auroni_banners';
            widthLimit = 1920; // Max for Hero/Sliders
        } else if (context === 'collection') {
            folderName = 'auroni_collections';
            widthLimit = 1920;
        }

        // 3. Handle File Type (Video vs Image)
        const isVideo = file.mimetype.startsWith('video');

        if (isVideo) {
            return {
                folder: 'auroni_videos',
                resource_type: 'video',
                format: 'mp4',
                public_id: file.fieldname + '-' + Date.now(),
                transformation: [
                    { width: widthLimit, crop: "limit" }, 
                    { quality: "auto:good", fetch_format: "auto" }
                ]
            };
        } else {
            return {
                folder: folderName,
                resource_type: 'image',
                format: 'webp', // Force WebP
                public_id: file.fieldname + '-' + Date.now(),
                transformation: [
                    { width: widthLimit, crop: "limit" }, // Resize if larger than limit
                    { quality: "auto" } // Auto optimization
                ]
            };
        }
    },
});

module.exports = { cloudinary, storage };
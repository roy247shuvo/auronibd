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
        // 1. Check Context (Passed via Query param: ?context=banner)
        const context = req.query.context || 'product';
        const isBanner = context === 'banner';
        
        // 2. Check File Type
        const isVideo = file.mimetype.startsWith('video');

        if (isVideo) {
            return {
                folder: 'auroni_videos',
                resource_type: 'video',
                format: 'mp4',
                public_id: file.fieldname + '-' + Date.now(),
                transformation: [
                    { width: isBanner ? 1920 : 1280, crop: "limit" }, // HD for banners
                    { quality: "auto:good", fetch_format: "auto" }
                ]
            };
        } else {
            return {
                folder: isBanner ? 'auroni_banners' : 'auroni_products',
                resource_type: 'image',
                format: 'webp',
                public_id: file.fieldname + '-' + Date.now(),
                transformation: [
                    // DYNAMIC RESIZING BASED ON CONTEXT
                    { width: isBanner ? 1920 : 1000, crop: "limit" }, 
                    { quality: "auto" } 
                ]
            };
        }
    },
});

module.exports = { cloudinary, storage };
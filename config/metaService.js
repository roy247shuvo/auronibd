const axios = require('axios');
const crypto = require('crypto');
const db = require('./database');

const hash = (data) => {
    if (!data) return null;
    return crypto.createHash('sha256').update(data.trim().toLowerCase()).digest('hex');
};

// Helper: Parse Cookies from Header
const getCookie = (req, name) => {
    try {
        const value = `; ${req.headers.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
    } catch (e) { return null; }
    return null;
};

const sendEvent = async (eventName, eventData, req) => {
    try {
        const [settings] = await db.query("SELECT meta_pixel_id, meta_conversion_api_token, meta_test_code FROM shop_settings LIMIT 1");
        const config = settings[0];

        if (!config || !config.meta_pixel_id || !config.meta_conversion_api_token) return;

        const user = req.session?.user || {};
        const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
        const userAgent = req.headers['user-agent'];
        
        // CRITICAL: Extract Facebook Cookies for Match Quality
        const fbp = getCookie(req, '_fbp');
        const fbc = getCookie(req, '_fbc');

        const payload = {
            data: [{
                event_name: eventName,
                event_time: Math.floor(Date.now() / 1000),
                event_source_url: req.protocol + '://' + req.get('host') + req.originalUrl,
                action_source: "website",
                event_id: eventData.event_id, // Support Deduplication
                user_data: {
                    client_ip_address: clientIp,
                    client_user_agent: userAgent,
                    fbp: fbp || undefined, // High Impact
                    fbc: fbc || undefined, // High Impact
                    em: eventData.email ? [hash(eventData.email)] : (user.email ? [hash(user.email)] : undefined),
                    ph: eventData.phone ? [hash(eventData.phone)] : (user.phone ? [hash(user.phone)] : undefined),
                    fn: eventData.first_name ? [hash(eventData.first_name)] : undefined,
                    ln: eventData.last_name ? [hash(eventData.last_name)] : undefined,
                    external_id: user.id ? [hash(user.id.toString())] : undefined
                },
                custom_data: eventData.custom_data, 
            }],
            test_event_code: config.meta_test_code || undefined 
        };

        await axios.post(
            `https://graph.facebook.com/v18.0/${config.meta_pixel_id}/events?access_token=${config.meta_conversion_api_token}`,
            payload
        );
        
        // console.log(`Meta Event Sent: ${eventName}`); 
    } catch (err) {
        // console.error("Meta CAPI Error", err.response?.data || err.message);
    }
};

module.exports = { sendEvent };
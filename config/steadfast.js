const axios = require('axios');
const db = require('./database');
require('dotenv').config(); // [ADDED] Load .env

// URL from documentation
const BASE_URL = 'https://portal.packzy.com/api/v1';

async function getConfig() {
    // [UPDATED] Check .env first, then fallback to DB
    let apiKey = process.env.STEADFAST_API_KEY;
    let secretKey = process.env.STEADFAST_SECRET_KEY;

    if (!apiKey || !secretKey) {
        const [rows] = await db.query("SELECT steadfast_api_key, steadfast_secret_key FROM shop_settings LIMIT 1");
        if (rows.length > 0) {
            apiKey = apiKey || rows[0].steadfast_api_key;
            secretKey = secretKey || rows[0].steadfast_secret_key;
        }
    }
    
    if (!apiKey) throw new Error("Steadfast API Key not configured");
    
    return {
        'Api-Key': apiKey,
        'Secret-Key': secretKey,
        'Content-Type': 'application/json'
    };
}

exports.bulkCreate = async (orders) => {
    try {
        const headers = await getConfig();
        
        // FIX: Steadfast expects 'data' to be a JSON STRING, not an Array object.
        const payload = { 
            data: JSON.stringify(orders) 
        };

        const response = await axios.post(`${BASE_URL}/create_order/bulk-order`, payload, { headers });
        return response.data;
    } catch (error) {
        if (error.response) {
            // Log full error for debugging
            console.error("Steadfast API Response Error:", JSON.stringify(error.response.data, null, 2));
            
            if (error.response.status === 500) {
                throw new Error("Steadfast Server Error (500). Likely Duplicate Invoice ID.");
            }
            
            // Return the error data so controller can handle it (instead of throwing)
            return error.response.data; 
        } else {
            console.error("Steadfast Network Error:", error.message);
            throw error;
        }
    }
};

exports.checkStatus = async (consignmentId) => {
    try {
        const headers = await getConfig();
        const response = await axios.get(`${BASE_URL}/status_by_cid/${consignmentId}`, { headers });
        return response.data;
    } catch (error) {
        return null;
    }
};

exports.getBalance = async () => {
    try {
        const headers = await getConfig();
        const response = await axios.get(`${BASE_URL}/get_balance`, { headers });
        return response.data;
    } catch (error) {
        return { current_balance: 0 };
    }
};

// [NEW] Fetch Payment Batches
exports.getPayments = async () => {
    try {
        const headers = await getConfig();
        const response = await axios.get(`${BASE_URL}/payments`, { headers });
        return response.data;
    } catch (error) {
        console.error("Steadfast Get Payments Error:", error.message);
        return [];
    }
};

// [NEW] Fetch Details of a specific Payment Batch
exports.getPaymentDetails = async (paymentId) => {
    try {
        const headers = await getConfig();
        const response = await axios.get(`${BASE_URL}/payments/${paymentId}`, { headers });
        return response.data;
    } catch (error) {
        console.error(`Steadfast Payment Details Error (${paymentId}):`, error.message);
        return null;
    }
};
const axios = require('axios');
require('dotenv').config();

const bkashConfig = {
    baseURL: process.env.BKASH_BASE_URL,
    username: process.env.BKASH_USERNAME,
    password: process.env.BKASH_PASSWORD,
    appKey: process.env.BKASH_APP_KEY,
    appSecret: process.env.BKASH_APP_SECRET
};

const headers = async (token = null) => {
    let h = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };

    if (token) {
        h['Authorization'] = token;
        h['x-app-key'] = bkashConfig.appKey;
    } else {
        h['username'] = bkashConfig.username;
        h['password'] = bkashConfig.password;
    }
    return h;
};

exports.grantToken = async () => {
    try {
        const response = await axios.post(
            `${bkashConfig.baseURL}/tokenized-checkout/auth/grant-token`,
            { app_key: bkashConfig.appKey, app_secret: bkashConfig.appSecret },
            { headers: await headers() }
        );
        return response.data.id_token;
    } catch (error) {
        console.error("bKash Token Error:", error.response ? error.response.data : error.message);
        throw new Error("Failed to get bKash Token");
    }
};

exports.createPayment = async (token, paymentDetails) => {
    try {
        const response = await axios.post(
            `${bkashConfig.baseURL}/tokenized-checkout/payment/create`,
            paymentDetails,
            { headers: await headers(token) }
        );
        return response.data;
    } catch (error) {
        const detailedError = error.response && error.response.data ? JSON.stringify(error.response.data) : error.message;
        console.error("bKash Create Error:", detailedError);
        throw new Error("Failed to create bKash Payment: " + detailedError);
    }
};

exports.executePayment = async (token, paymentID) => {
    try {
        const response = await axios.post(
            `${bkashConfig.baseURL}/tokenized-checkout/payment/execute`,
            { paymentId: paymentID }, // <--- FIXED: API expects 'paymentId', not 'paymentID'
            { headers: await headers(token) }
        );
        return response.data;
    } catch (error) {
        const detailedError = error.response && error.response.data ? JSON.stringify(error.response.data) : error.message;
        console.error("bKash Execute Error:", detailedError);
        throw new Error("Failed to execute bKash Payment: " + detailedError);
    }
};
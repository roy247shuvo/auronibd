require('dotenv').config();
const mysql = require('mysql2');

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4',
    timezone: '+06:00'
});

// 2. FORCE the Database Session to switch to GMT+6 immediately
pool.on('connection', (connection) => {
    connection.query('SET time_zone = "+06:00"');
    connection.query('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci');
});

// Convert the pool to use Promises
const promisePool = pool.promise();

module.exports = promisePool;
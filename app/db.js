// db.js - PostgreSQL 연결 풀 설정
const { Pool } = require("pg");

const pool = new Pool({
    host: process.env.DB_HOST || "localhost",
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER || "todouser",
    password: process.env.DB_PASSWORD || "todopass",
    database: process.env.DB_NAME || "tododb",
});

module.exports = pool;
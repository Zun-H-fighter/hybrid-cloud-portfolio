// db.js - PostgreSQL 연결 풀 설정
const { Pool } = require("pg");

for (const key of ["DB_USER", "DB_PASSWORD", "DB_NAME"]) {
  if (!process.env[key]) {
    throw new Error(`환경변수 ${key} 가 설정되지 않았습니다`);
  }
}

const pool = new Pool({
  host: process.env.DB_HOST || "db",
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

module.exports = pool;
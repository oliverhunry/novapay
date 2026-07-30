require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

pool.query('SELECT id, username, mobile, created_at FROM users ORDER BY id DESC LIMIT 10')
  .then(r => {
    console.table(r.rows);
    pool.end();
  })
  .catch(err => {
    console.error("Query error:", err.message);
    pool.end();
  });
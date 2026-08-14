// fix-versions-diff.js
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function fix() {
  const client = await pool.connect();
  try {
    console.log('🔄 Adding diff_data column...');

    await client.query(`
      ALTER TABLE content_versions
        ADD COLUMN IF NOT EXISTS diff_data JSONB DEFAULT '{}'
    `);

    console.log('✅ diff_data column added!');
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

fix();

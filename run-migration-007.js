const fs = require('fs');
const { Client } = require('pg');
require('dotenv').config();

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  
  try {
    const sql = fs.readFileSync('./migrations/007_content_actions.sql', 'utf8');
    await client.query(sql);
    console.log('✅ Migration 007 applied successfully');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    await client.end();
  }
})();

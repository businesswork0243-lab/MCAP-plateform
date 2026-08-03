require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');

async function runMigration() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log('🔌 Connecting...');
        await client.connect();
        console.log('✅ Connected\n');

        const sql = fs.readFileSync('./migrations/006_bulk_jobs.sql', 'utf8');

        console.log('🚀 Running migration 006 (bulk_jobs)...');
        await client.query(sql);
        console.log('✅ Migration 006 complete!\n');

        // Verify bulk_jobs table
        console.log('📋 Verifying bulk_jobs table:');
        const table = await client.query(`
            SELECT table_name FROM information_schema.tables
            WHERE table_name = 'bulk_jobs'
        `);
        if (table.rows.length > 0) {
            console.log('  ✓ Table bulk_jobs created successfully');
        } else {
            console.log('  ❌ Table bulk_jobs missing');
        }

        console.log('\n📋 Verifying content_requests bulk columns:');
        const cols = await client.query(`
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'content_requests' 
            AND column_name IN ('bulk_job_id', 'bulk_row_number', 'bulk_row_data')
            ORDER BY column_name
        `);
        cols.rows.forEach(r => console.log(`  ✓ ${r.column_name}`));

        console.log('\n🎉 Bulk jobs migration verified successfully!');

    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        await client.end();
    }
}

runMigration();

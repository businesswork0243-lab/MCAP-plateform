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

        const sql = fs.readFileSync('./migrations/007_fix_varchar_overflow.sql', 'utf8');

        console.log('🚀 Running migration 007 (fix_varchar_overflow)...');
        await client.query(sql);
        console.log('✅ Migration 007 complete!\n');

        // Verify column types
        console.log('📋 Verifying updated column types:');
        const cols = await client.query(`
            SELECT column_name, data_type, character_maximum_length
            FROM information_schema.columns
            WHERE table_name = 'content_requests'
            AND column_name IN ('audience', 'writing_structure', 'narrative_perspective', 'cta_type', 'reading_level', 'language', 'target_platform', 'humanization_level')
            ORDER BY column_name
        `);
        cols.rows.forEach(r => {
            const size = r.character_maximum_length ? `(${r.character_maximum_length})` : '';
            console.log(`  ✓ ${r.column_name}: ${r.data_type}${size}`);
        });

        console.log('\n🎉 VARCHAR overflow fix migration verified successfully!');

    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        await client.end();
    }
}

runMigration();

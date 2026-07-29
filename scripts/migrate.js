import fs from 'fs';
import path from 'path';
import pool from '../src/db/pool.js';

const __dirname = new URL('.', import.meta.url).pathname;

async function runMigrations() {
  try {
    console.log('🔄 Running migrations...');

    const migrationFile = path.join(__dirname, '../src/db/migrations/001-multitenancy.sql');
    const sql = fs.readFileSync(migrationFile, 'utf-8');

    await pool.query(sql);

    console.log('✅ Migrations completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

runMigrations();

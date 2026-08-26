import fs from 'fs';
import path from 'path';
import pool from '../src/db/pool.js';

const __dirname = new URL('.', import.meta.url).pathname;

async function runMigrations() {
  try {
    console.log('🔄 Running migrations...');

    const dir = path.join(__dirname, '../src/db/migrations');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

    for (const file of files) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf-8');
      await pool.query(sql);
      console.log(`   ✓ ${file}`);
    }

    console.log('✅ Migrations completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

runMigrations();

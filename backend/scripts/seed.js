import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { fileURLToPath } from 'url';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env') });

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/typeahead';
const CSV_PATH = path.join(__dirname, '..', 'unigram_freq.csv');
const BATCH_SIZE = 5000;

async function seed() {
  console.log('[Seed] Connecting to PostgreSQL...');
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  // create table if not exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS queries (
      id SERIAL PRIMARY KEY,
      query TEXT UNIQUE NOT NULL,
      count BIGINT DEFAULT 0,
      last_searched_at TIMESTAMPTZ
    )
  `);

  // clear existing data for a clean load
  await pool.query('DELETE FROM queries');
  console.log('[Seed] Cleared existing data');

  // read CSV
  console.log(`[Seed] Reading ${CSV_PATH}...`);
  const fileContent = fs.readFileSync(CSV_PATH, 'utf-8');
  const lines = fileContent.split('\n');

  let batch = [];
  let totalInserted = 0;
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) { // skip header
    const line = lines[i]?.trim();
    if (!line) continue;

    // csv format: word,count
    const commaIdx = line.lastIndexOf(',');
    if (commaIdx === -1) continue;

    const query = line.substring(0, commaIdx).trim().toLowerCase();
    const count = parseInt(line.substring(commaIdx + 1).trim(), 10);

    // filter out garbage
    if (!query || query.length < 2 || isNaN(count) || count <= 0) {
      skipped++;
      continue;
    }

    // skip entries that are just numbers or special characters
    if (/^\d+$/.test(query) || /^[^a-z]+$/.test(query)) {
      skipped++;
      continue;
    }

    batch.push({ query, count });

    if (batch.length >= BATCH_SIZE) {
      await insertBatch(pool, batch);
      totalInserted += batch.length;
      console.log(`[Seed] Inserted ${totalInserted} queries...`);
      batch = [];
    }
  }

  // insert remaining
  if (batch.length > 0) {
    await insertBatch(pool, batch);
    totalInserted += batch.length;
  }

  // create indexes
  await pool.query('CREATE INDEX IF NOT EXISTS idx_queries_query ON queries (query)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_queries_count ON queries (count DESC)');
  console.log('[Seed] Indexes created');

  console.log(`[Seed] Done! Inserted ${totalInserted} queries (skipped ${skipped})`);
  await pool.end();
}

// bulk insert a batch of entries using a single multi-row INSERT
async function insertBatch(pool, entries) {
  if (entries.length === 0) return;

  const values = [];
  const params = [];
  let paramIndex = 1;

  for (const { query, count } of entries) {
    values.push(`($${paramIndex}, $${paramIndex + 1})`);
    params.push(query, count);
    paramIndex += 2;
  }

  await pool.query(
    `INSERT INTO queries (query, count) VALUES ${values.join(', ')}
     ON CONFLICT (query) DO UPDATE SET count = EXCLUDED.count`,
    params
  );
}

seed().catch(err => {
  console.error('[Seed] Error:', err);
  process.exit(1);
});

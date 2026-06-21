import pg from 'pg';

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/typeahead';

let pool = null;

export async function connect() {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  // test the connection with a retry mechanism to handle Neon serverless DB cold starts
  let retries = 5;
  while (retries > 0) {
    try {
      const client = await pool.connect();
      client.release();
      break;
    } catch (err) {
      retries--;
      if (retries === 0) {
        throw err;
      }
      console.log(`[DB] Connection failed. Retrying in 3 seconds... (${retries} retries left)`);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  // create table if it doesn't exist
  await pool.query(`
    CREATE TABLE IF NOT EXISTS queries (
      id SERIAL PRIMARY KEY,
      query TEXT UNIQUE NOT NULL,
      count BIGINT DEFAULT 0,
      last_searched_at TIMESTAMPTZ
    )
  `);

  // create indexes for fast prefix lookups and sorting
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_queries_query ON queries (query)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_queries_count ON queries (count DESC)
  `);

  console.log('[DB] Connected to PostgreSQL (Neon)');
}

// fetch top results matching a prefix, sorted by count descending
export async function getTopByPrefix(prefix, limit = 10) {
  const escapedPrefix = escapeForLike(prefix);
  const result = await pool.query(
    `SELECT query, count FROM queries
     WHERE query LIKE $1
     ORDER BY count DESC
     LIMIT $2`,
    [escapedPrefix.toLowerCase() + '%', limit]
  );
  return result.rows;
}

// insert or update a single query
export async function upsertQuery(query, countIncrement = 1) {
  return pool.query(
    `INSERT INTO queries (query, count, last_searched_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (query)
     DO UPDATE SET count = queries.count + $2, last_searched_at = NOW()`,
    [query, countIncrement]
  );
}

// batch upsert multiple queries at once (used by batch writer)
// single multi-row INSERT ... ON CONFLICT in one SQL round-trip
export async function batchUpsert(entries) {
  // entries: [{query, count}]
  if (entries.length === 0) return;

  const queries = entries.map(e => e.query);
  const counts = entries.map(e => e.count);

  await pool.query(
    `INSERT INTO queries (query, count, last_searched_at)
     SELECT unnest($1::text[]), unnest($2::bigint[]), NOW()
     ON CONFLICT (query)
     DO UPDATE SET count = queries.count + EXCLUDED.count, last_searched_at = NOW()`,
    [queries, counts]
  );
}

// load all queries (for building trie at startup)
export async function getAllQueries() {
  const result = await pool.query(
    'SELECT query, count FROM queries'
  );
  return result.rows;
}

// get total row count
export async function getQueryCount() {
  const result = await pool.query('SELECT COUNT(*) as total FROM queries');
  return parseInt(result.rows[0].total, 10);
}

// close connection pool
export async function close() {
  if (pool) {
    await pool.end();
    console.log('[DB] PostgreSQL connection closed');
  }
}

// escape special LIKE pattern characters in user input
function escapeForLike(str) {
  return str.replace(/[%_\\]/g, '\\$&');
}

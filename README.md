# Search Typeahead System

A search typeahead system that suggests popular queries as users type, with distributed caching, trending searches, and batch writes.

## Project Structure

```
├── frontend/          # React + Vite client (deployed on Vercel)
│   ├── src/
│   │   ├── components/
│   │   │   ├── SearchBox.jsx
│   │   │   ├── StatsPanel.jsx
│   │   │   └── TrendingSection.jsx
│   │   ├── App.jsx
│   │   └── main.jsx
│   └── package.json
│
├── backend/           # Express.js API server
│   ├── routes/
│   │   ├── suggest.js
│   │   ├── search.js
│   │   └── cacheDebug.js
│   ├── scripts/
│   │   └── seed.js
│   ├── index.js
│   ├── db.js
│   ├── cache.js
│   ├── consistentHash.js
│   ├── batchWriter.js
│   ├── trending.js
│   ├── logger.js
│   ├── package.json
│   └── docker-compose.yml
│
└── README.md
```

## Architecture

```
┌────────────────┐       ┌───────────────────────────────────────────┐
│   React UI     │──────▶│              Express Server               │
│  (Vercel)      │       │                                           │
└────────────────┘       │  ┌─────────┐  ┌────────┐  ┌───────────┐  │
                         │  │  Trie   │  │Trending│  │  Batch    │  │
                         │  │(in-mem) │  │Tracker │  │  Writer   │  │
                         │  └────┬────┘  └────────┘  └─────┬─────┘  │
                         │       │                         │        │
                         │  ┌────▼────────────────┐  ┌─────▼─────┐  │
                         │  │  Redis Cache         │  │PostgreSQL │  │
                         │  │  (Consistent Hash)   │  │ (queries) │  │
                         │  │  3 logical nodes     │  │           │  │
                         │  └─────────────────────┘  └───────────┘  │
                         └───────────────────────────────────────────┘
```

## Setup

### Frontend (Vercel)

```bash
cd frontend
npm install
npm run dev       # Local development at http://localhost:5173
```

Set `VITE_API_URL` in Vercel environment variables to point to your deployed backend URL.

### Backend

```bash
cd backend
cp .env.example .env    # Edit with your DB/Redis credentials
npm install
npm run seed            # Seed the database (333k queries)
npm run dev             # Development with auto-reload
npm start               # Production
```

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `DATABASE_URL` | — | PostgreSQL connection string |
| `REDIS_URL` | — | Redis connection string |
| `CACHE_TTL_SECONDS` | `60` | Cache entry TTL |
| `CACHE_NODE_COUNT` | `3` | Number of logical cache nodes |
| `BATCH_FLUSH_INTERVAL_MS` | `10000` | Batch writer flush interval |
| `BATCH_MAX_BUFFER_SIZE` | `50` | Max buffer before forced flush |

## API Documentation

### GET /suggest?q=\<prefix\>

Returns top 10 suggestions matching the prefix, sorted by count (with trending boost).

**Request:** `GET /suggest?q=java`

**Response:**
```json
{
  "suggestions": [
    { "query": "java", "count": 55360149, "trendingScore": 55360149 },
    { "query": "javascript", "count": 25766226, "trendingScore": 25766226 }
  ],
  "source": "cache",
  "latencyMs": 2.65
}
```

### POST /search

Submits a search query. Adds to batch buffer and trending tracker.

**Request:**
```json
POST /search
{ "query": "machine learning" }
```

**Response:**
```json
{ "message": "Searched", "query": "machine learning" }
```

### GET /cache/debug?prefix=\<prefix\>

Shows cache routing info via consistent hashing.

### GET /trending

Returns currently trending queries based on recent activity.

### GET /stats

Returns system-wide stats: cache hit rate, latency p50/p95, batch writer metrics.

## Design Choices & Trade-offs

### Why Trie + PostgreSQL (not just PostgreSQL)?

PostgreSQL `LIKE 'prefix%'` queries scan even with indexes — O(n) on large datasets. The Trie provides O(prefix_length) lookups with precomputed top-10 at each node. PostgreSQL serves as the persistent source of truth, Trie is the hot in-memory path.

**Trade-off:** Trie uses memory (~200MB for 333k entries). Acceptable for a single-server demo.

### Why Consistent Hashing for Cache?

- Adding/removing a cache node remaps only ~1/N keys (vs rehashing everything with modular hashing)
- 150 virtual nodes per physical node ensures even key distribution
- Each "logical node" uses a Redis key prefix (e.g., `node0:java`). In production, these would be separate Redis instances.

### Trending: Exponential Time-Decay

**Formula:** `trending_score = base_count + Σ(recent_count × e^(-0.05 × age_minutes))`

- Recent searches get a boost that decays with a half-life of ~14 minutes
- After 1 hour of inactivity, the boost is < 5% of peak — prevents permanent over-ranking
- Tracked in 1-minute time buckets (sliding window of 60 buckets)

### Batch Writes

- Search submissions buffer in memory, flushed every 10 seconds or at 50 entries
- Duplicate queries are aggregated (10 searches for "java" = 1 DB write with `$inc: 10`)
- **Failure trade-off:** If the server crashes before a flush, buffered counts are lost. For production, we'd use a WAL (write-ahead log) or persistent queue.

## Performance

| Metric | Value |
|--------|-------|
| Suggestion latency (cache hit) | ~2-6ms |
| Suggestion latency (trie lookup) | ~3-15ms |
| Cache hit rate | Increases with usage (60s TTL) |
| Dataset size | 333,307 queries |
| Batch write reduction | Depends on search frequency; typically 60-90% fewer DB writes |

## Dataset

**Source:** `unigram_freq.csv` — English word frequencies derived from Google Books Ngram Viewer. Contains 333,333 entries with word and occurrence count.

**Loading:** The `scripts/seed.js` script reads the CSV, filters out single-character and numeric-only entries, and bulk-inserts into PostgreSQL with indexes on `query` and `count`.

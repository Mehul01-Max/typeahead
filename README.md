# Search Typeahead System

A search typeahead system that suggests popular queries as users type, with distributed caching, trending searches, and batch writes.

## Architecture

```
┌────────────────┐       ┌───────────────────────────────────────────┐
│   React UI     │──────▶│              Express Server               │
│  (Vite build)  │       │                                           │
└────────────────┘       │  ┌─────────┐  ┌────────┐  ┌───────────┐  │
                         │  │  Trie   │  │Trending│  │  Batch    │  │
                         │  │(in-mem) │  │Tracker │  │  Writer   │  │
                         │  └────┬────┘  └────────┘  └─────┬─────┘  │
                         │       │                         │        │
                         │  ┌────▼────────────────┐  ┌─────▼─────┐  │
                         │  │  Redis Cache         │  │  MongoDB  │  │
                         │  │  (Consistent Hash)   │  │ (queries) │  │
                         │  │  3 logical nodes     │  │           │  │
                         │  └─────────────────────┘  └───────────┘  │
                         └───────────────────────────────────────────┘
```

### Data Flow

1. **Suggestion Request:** Client → Cache (Redis) → Trie (in-memory) → Response
2. **Search Submission:** Client → Batch Buffer → (periodic flush) → MongoDB → Trie update → Cache invalidation
3. **Trending:** Recent searches tracked in time-bucketed windows with exponential decay scoring

## Tech Stack

| Component | Technology | Justification |
|-----------|-----------|---------------|
| Backend | Node.js + Express | Event-driven, non-blocking I/O for low-latency requests |
| Database | MongoDB | Document store with flexible schema, atomic `$inc` for count updates, regex prefix queries |
| Cache | Redis | Sub-millisecond reads, native TTL, industry-standard caching layer |
| Frontend | React (Vite) | Component-based UI with efficient re-rendering |
| Dataset | unigram_freq.csv | 333,000+ real English word frequencies from Google Books Ngrams |

## Setup & Run

### Prerequisites
- Node.js 18+
- Docker

### Environment Configuration

Copy the example env file and update values as needed:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `MONGO_URL` | `mongodb://localhost:27017` | MongoDB connection string |
| `MONGO_DB_NAME` | `typeahead` | MongoDB database name |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `CACHE_TTL_SECONDS` | `60` | Cache entry TTL |
| `CACHE_NODE_COUNT` | `3` | Number of logical cache nodes |
| `BATCH_FLUSH_INTERVAL_MS` | `10000` | Batch writer flush interval |
| `BATCH_MAX_BUFFER_SIZE` | `50` | Max buffer before forced flush |

For cloud-hosted MongoDB/Redis (e.g., MongoDB Atlas + Redis Cloud):
```bash
MONGO_URL=mongodb+srv://user:pass@cluster.mongodb.net
REDIS_URL=redis://user:pass@redis-host:6379
```

### Steps

```bash
# 1. Start MongoDB and Redis (local Docker)
docker-compose up -d

# 2. Copy env file
cp .env.example .env

# 3. Install dependencies
npm install
cd client && npm install && cd ..

# 4. Seed the database (loads 333k queries)
npm run seed

# 5. Build the React frontend
cd client && npm run build && cd ..

# 6. Start the server
npm start
# Server runs on http://localhost:3000
```

### Development Mode

Run the backend and React dev server separately:

```bash
# Terminal 1: Backend
npm start

# Terminal 2: React dev server (with hot reload)
cd client && npm run dev
# Opens on http://localhost:5173 (proxies API calls to :3000)
```

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

**Request:** `GET /cache/debug?prefix=iph`

**Response:**
```json
{
  "cacheDebug": {
    "assignedNode": "node2",
    "redisKey": "node2:iph",
    "cacheStatus": "HIT",
    "hashInfo": {
      "hashValue": 2952454930,
      "totalNodes": 3,
      "totalVirtualNodes": 450
    }
  },
  "cacheStats": { "hits": 5, "misses": 2, "hitRate": "71.4%" },
  "batchWriterStats": { "writeReduction": "80.0%" }
}
```

### GET /trending

Returns currently trending queries based on recent activity.

### GET /stats

Returns system-wide stats: cache hit rate, latency p50/p95, batch writer metrics.

## Design Choices & Trade-offs

### Why Trie + MongoDB (not just MongoDB)?

MongoDB regex queries (`^prefix`) scan even with indexes — O(n) on large datasets. The Trie provides O(prefix_length) lookups with precomputed top-10 at each node. MongoDB serves as the persistent source of truth, Trie is the hot in-memory path.

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
| Trie build time | ~25-30 seconds at startup |
| Batch write reduction | Depends on search frequency; typically 60-90% fewer DB writes |

## Dataset

**Source:** `unigram_freq.csv` — English word frequencies derived from Google Books Ngram Viewer. Contains 333,333 entries with word and occurrence count.

**Loading:** The `scripts/seed.js` script reads the CSV, filters out single-character and numeric-only entries, and bulk-inserts into MongoDB with indexes on `query` and `count`.

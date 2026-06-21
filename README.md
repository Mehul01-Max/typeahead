# Search Typeahead System

A production-grade, highly optimized Search Typeahead autocomplete system built with **React** (Vite), **Express.js**, **PostgreSQL**, and **Redis**. The system supports low-latency autocomplete suggestions, distributed caching using consistent hashing, real-time trending searches with exponential time-decay, and batch writes to minimize database pressure.

---

## 🚀 System Architecture

The architecture is designed to handle high-throughput reads (typeahead queries) and write-heavy workloads (search submissions) efficiently:

```
                  ┌────────────────────────────────────────┐
                  │               React Client             │
                  │              (Vite, Debounced)         │
                  └───────────────────┬────────────────────┘
                                      │
                       HTTP GET       │      HTTP POST
                      /suggest        │      /search
                                      ▼
                  ┌────────────────────────────────────────┐
                  │             Express Server             │
                  │                                        │
                  │  ┌──────────────┐      ┌────────────┐  │
                  │  │   Trending   │      │   Batch    │  │
                  │  │   Tracker    │      │   Writer   │  │
                  │  └──────┬───────┘      └─────┬──────┘  │
                  └─────────┼────────────────────┼─────────┘
                            │ (Exp Decay)        │ (Bulk upsert)
                            ▼                    ▼
             ┌──────────────────────────────┐  ┌──────────────────┐
             │      Redis Cache Node        │  │    PostgreSQL    │
             │   (Consistent Hash Ring)     │  │  (Primary Store) │
             │   node0  │  node1  │  node2  │  │  - Queries Table │
             └──────────────────────────────┘  └──────────────────┘
```

### Architectural Highlights
- **Consistent Hashing**: Suggestion cache keys are distributed across a ring of $3$ logical cache nodes (`node0`, `node1`, `node2`) using an MD5-based hashing ring with $150$ virtual nodes per physical node to prevent hotspotting.
- **Cache Invalidation**: On a batch flush, cache keys for all prefixes of modified queries are deleted (e.g., for query "java", cache keys `"j"`, `"ja"`, `"jav"`, `"java"` are invalidated).
- **Time-Decayed Trending**: Trending score incorporates historical query counts and real-time recency based on 1-minute time buckets over a 60-minute sliding window.
- **Batch Writer**: Search events are aggregated in an in-memory buffer and flushed as a single multi-row upsert transaction to PostgreSQL every 10 seconds or when the buffer size reaches 50 unique queries.

---

## 📁 Project Structure

```
├── frontend/             # React + Vite UI client
│   ├── src/
│   │   ├── components/
│   │   │   ├── SearchBox.jsx        # Input box with keyboard navigation & debounced suggestions
│   │   │   ├── StatsPanel.jsx       # Real-time dashboard showing hit rates, latency, & batch stats
│   │   │   └── TrendingSection.jsx  # Display of real-time trending searches
│   │   ├── App.jsx
│   │   ├── App.css
│   │   └── main.jsx
│   └── package.json
│
├── backend/              # Express.js API Server
│   ├── routes/
│   │   ├── suggest.js               # Route for autocomplete recommendations
│   │   ├── search.js                # Route for submitting search queries
│   │   └── cacheDebug.js            # Route for inspecting consistent hash routing
│   ├── scripts/
│   │   └── seed.js                  # Ingestion script for 333k unigram queries
│   ├── batchWriter.js               # In-memory accumulator and database batching engine
│   ├── cache.js                     # Cache controller with consistent hashing integration
│   ├── consistentHash.js            # Custom consistent hashing ring class
│   ├── db.js                        # PostgreSQL database pool config and query models
│   ├── docker-compose.yml           # Redis container setup
│   ├── env.js                       # Environment variable loader
│   ├── index.js                     # Server entry point
│   ├── logger.js                    # Custom latency tracker middleware
│   ├── trending.js                  # Recency ranking & exponential time-decay engine
│   ├── unigram_freq.csv             # English word frequencies (333,333 entries)
│   └── package.json
│
└── README.md
```

---

## 🛠️ Setup and Installation

### Prerequisites
- **Node.js** (v18+)
- **Docker** (for Redis cache container)
- **PostgreSQL** instance (Local or cloud hosted e.g. Neon DB)

### 1. Database & Cache Infrastructure
Start the Redis cache service using Docker:
```bash
cd backend
docker compose up -d
```

### 2. Backend Server Setup
Configure the environment variables:
```bash
cp .env.example .env
```
Edit the `.env` file with your credentials:
```env
PORT=3000
DATABASE_URL=postgresql://<user>:<password>@<host>/<dbname>?sslmode=require
REDIS_URL=redis://localhost:6379
BATCH_FLUSH_INTERVAL_MS=10000
BATCH_MAX_BUFFER_SIZE=50
CACHE_TTL_SECONDS=60
CACHE_NODE_COUNT=3
```

Install backend dependencies and seed the database with the dataset (~333,307 queries loaded):
```bash
npm install
npm run seed
```

Start the backend server in development mode:
```bash
npm run dev
```

### 3. Frontend Client Setup
Install frontend dependencies and start the development server:
```bash
cd ../frontend
npm install
npm run dev
```
By default, the client runs at `http://localhost:5173`. Make sure the backend port matches the API endpoint.

---

## 🔌 API Documentation

### 1. Get Suggestions
Returns up to 10 prefix-matching suggestions sorted by search counts (plus trending boost, if applicable).
- **Endpoint**: `GET /suggest?q=<prefix>`
- **Sample Request**: `GET http://localhost:3000/suggest?q=jav`
- **Sample Response**:
```json
{
  "suggestions": [
    { "query": "java", "count": 55360149, "trendingScore": 55360149 },
    { "query": "javascript", "count": 25766226, "trendingScore": 25766226 }
  ],
  "source": "cache",
  "latencyMs": 1.45
}
```

### 2. Submit Search Query
Records search execution. Increments count, updates recency, and schedules database syncing via the Batch Writer.
- **Endpoint**: `POST /search`
- **Payload**:
```json
{
  "query": "consistent hashing"
}
```
- **Response**:
```json
{
  "message": "Searched",
  "query": "consistent hashing"
}
```

### 3. Cache Debug Routing
Inspects which logical cache node is mapped to the prefix using Consistent Hashing.
- **Endpoint**: `GET /cache/debug?prefix=<prefix>`
- **Sample Request**: `GET http://localhost:3000/cache/debug?prefix=jav`
- **Sample Response**:
```json
{
  "cacheDebug": {
    "prefix": "jav",
    "assignedNode": "node1",
    "redisKey": "node1:jav",
    "cacheStatus": "HIT",
    "ttlRemaining": 48,
    "hashInfo": {
      "key": "jav",
      "hashValue": 3121545648,
      "assignedNode": "node1",
      "totalNodes": 3,
      "totalVirtualNodes": 450,
      "allNodes": ["node0", "node1", "node2"]
    }
  }
}
```

### 4. Fetch System Statistics
Returns latency percentiles (p50/p95), cache metrics, and batch writer compression metrics.
- **Endpoint**: `GET /stats`

---

## 🧠 Design Choices & Key Implementations

### 1. Distributed Cache via Consistent Hashing
Instead of standard modular hashing (`hash(key) % N`), which triggers $100\%$ cache invalidation when nodes are added or removed, a custom **Consistent Hashing Ring** was built:
* **Virtual Nodes**: Each physical node maps to 150 virtual nodes on a 32-bit ring.
* **Distribution Balance**: Virtual nodes distribute keys evenly, avoiding hot spots.
* **Binary Search Routing**: `getNode(key)` performs binary search ($O(\log(\text{nodes} \times \text{replicas}))$) to map the hashed key to its clockwise neighbor node prefix.

### 2. Exponential Time-Decay Trending Engine
To ensure recency influences autocomplete suggestions without permanently over-ranking historic terms, searches are tracked in 1-minute time buckets over a 60-minute sliding window:
$$\text{trending\_score} = \text{base\_count} + \sum (\text{recent\_count} \times e^{-\lambda \times \text{age\_minutes}} \times 10000)$$
* **Decay Parameter ($\lambda = 0.05$)**: Corresponds to a half-life of ~14 minutes.
* **Cleanup Loop**: A background thread clears buckets older than 1 hour.
* **Staleness Protection**: Since trending calculations are performed on cache misses, stale rankings are evicted through active cache invalidations on search flushes.

### 3. Batch Writer (Write Reduction Engine)
Every `/search` updates the query counts. Doing synchronous database writes for every search would choke the database.
* **Aggregation**: If "iphone" is searched 100 times in 10 seconds, it's combined into `count = count + 100`.
* **Periodic & Bound Flushes**: The buffer flushes either every 10 seconds or when the queue hits 50 unique queries, executing a single PostgreSQL transaction (`BEGIN ... COMMIT`) to apply updates.

---

## 🖼️ Application Screenshots & UI Flow

Below are actual screenshots from the running application:

### 1. Autocomplete Search Box with Keyboard Navigation & Performance Overlay
Displays instant autocomplete suggestions from the seeded 333k unigram database. It also displays the latency and response source (Cache Hit vs. Database Fallback) in real-time.

![Autocomplete Search and Latency Overlay](./Screenshot%202026-06-22%20at%2001.39.39.png)

### 2. Real-time Decay-based Trending Searches Sidebar
Displays the active trending list. As searches are performed, queries bubble up to the top of the trending panel. This list is dynamically weighted using the time-decay factor:
$$\text{trending\_score} = \text{base\_count} + \sum (\text{recent\_count} \times e^{-0.05 \times \text{age\_minutes}} \times 10000)$$

![Decay-based Trending Sidebar](./Screenshot%202026-06-22%20at%2001.39.49.png)

### 3. Integrated Diagnostics & Performance Panel
Tracks metrics including cache hit rate, p50 and p95 request latencies, and batch writer efficiency (percentage of writes saved via aggregation).

![Diagnostics Panel](./Screenshot%202026-06-22%20at%2001.40.09.png)

---

## 📊 Performance Report

A detailed performance evaluation was conducted on the running system, analyzing latency distribution, cache hit ratios, and write buffering efficiency.

The comprehensive findings are documented in the separate [PERFORMANCE_REPORT.md](file:///Users/mehulagarwal/Documents/HLD-Project/PERFORMANCE_REPORT.md) file.

---

## 📝 Verification & Demonstration Checklist
- [x] **Ingestion**: 333k unigram query words indexed on Postgres (`idx_queries_query`, `idx_queries_count`).
- [x] **Prefix Match**: Matches `LOWER(query) LIKE LOWER(prefix%)` instantly.
- [x] **Debouncing**: React input triggers API queries after a 300ms idle state.
- [x] **Distributed cache mapping**: Routing verified via `/cache/debug`.
- [x] **Trending Ranking**: Newly searched terms immediately jump up in suggestions.
- [x] **Batching logs**: Console logs confirm write reduction during high write bursts.

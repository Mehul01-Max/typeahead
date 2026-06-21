# System Architecture & Technical Design Report

This report outlines the complete architecture, dataset instructions, API references, design choices, trade-offs, and performance metrics of the **Search Typeahead Autocomplete System**.

---

## 1. System Architecture

The system is designed to handle high-read throughput (as users type) and heavy-write update volume (as searches are submitted).

```
                  ┌────────────────────────────────────────┐
                  │               React Client             │
                  │             (Vite UI, Debounced)       │
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

### Components

1. **React UI Frontend (`frontend/`)**: Displays search results and suggestions with a 300ms debouncing logic to prevent flooding the backend with intermediate keystrokes.
2. **Express Server Backend (`backend/`)**: Receives requests, manages coordination, tracks latency metrics, and orchestrates caching and DB write buffering.
3. **Consistent Hash Ring Cache Layer (`backend/cache.js`, `backend/consistentHash.js`)**:
   - Shards keys across 3 logical cache nodes (`node0`, `node1`, `node2`).
   - A key is hashed (MD5), and a binary search finds the first virtual node situated clockwise on the ring ($150$ virtual nodes per physical node are used to prevent hotspots).
4. **Trending Engine (`backend/trending.js`)**: Tracks query frequencies in 1-minute buckets over a sliding 60-minute window. An exponential time-decay score ($\lambda = 0.05$, half-life of ~14 min) gives a ranking boost to recently popular terms.
5. **Batch Writer (`backend/batchWriter.js`)**: Buffers incoming search events in memory to reduce direct PostgreSQL write pressure. Flushes the buffer every 10 seconds or when 50 unique queries are accumulated.

---

## 2. Dataset Ingestion & Seeding

### Source Dataset
The application uses the **Kaggle English Word Frequency dataset** (derived from the Google Web Trillion Word Corpus). The dataset contains 333,333 unique English words accompanied by their historical corpus frequency count.

### Loading Instructions
1. **Configure Environment**: Update the database credentials in `backend/.env`:
   ```env
   DATABASE_URL=postgresql://<user>:<password>@<host>/<dbname>?sslmode=require
   ```
2. **Run Dependency Ingest**: Run the following scripts from the `backend/` directory:
   ```bash
   npm install
   npm run seed
   ```
3. **Database Schema & Indexes**:
   The seed script automatically initializes a `queries` table:
   ```sql
   CREATE TABLE IF NOT EXISTS queries (
     id SERIAL PRIMARY KEY,
     query TEXT UNIQUE NOT NULL,
     count BIGINT DEFAULT 0,
     last_searched_at TIMESTAMPTZ
   );
   ```
   It applies B-tree indexes for rapid prefix search and order matching:
   - `idx_queries_query` on `query` (Prefix scan optimization).
   - `idx_queries_count` on `count DESC` (Sorting optimization).

---

## 3. API Documentation

### 1. GET `/suggest`
Retrieves the top 10 prefix-matching suggestions sorted by frequency (historical + trending boost).
- **Request**: `GET http://localhost:3000/suggest?q=jav`
- **Response**:
  ```json
  {
    "suggestions": [
      { "query": "java", "count": 55360150, "trendingScore": 55369983.31 },
      { "query": "javascript", "count": 25766236, "trendingScore": 25766236 }
    ],
    "source": "cache",
    "latencyMs": 1.45
  }
  ```

### 2. POST `/search`
Submits a query search event, updating in-memory trending metrics, invalidating suggestion cache keys, and adding counts to the batch queue.
- **Request**: `POST http://localhost:3000/search`
- **Body**:
  ```json
  { "query": "java" }
  ```
- **Response**:
  ```json
  { "message": "Searched", "query": "java" }
  ```

### 3. GET `/cache/debug`
Inspects routing details across the consistent hashing cache ring.
- **Request**: `GET http://localhost:3000/cache/debug?prefix=jav`
- **Response**:
  ```json
  {
    "cacheDebug": {
      "prefix": "jav",
      "assignedNode": "node1",
      "redisKey": "node1:jav",
      "cacheStatus": "HIT",
      "ttlRemaining": 52,
      "hashInfo": {
        "key": "jav",
        "hashValue": 3121545648,
        "assignedNode": "node1",
        "totalNodes": 3,
        "totalVirtualNodes": 450
      }
    }
  }
  ```

### 4. GET `/stats`
Returns system performance statistics, including cache hit rates, batch writer compression ratios, and suggestions latency metrics.

---

## 4. Design Choices & Trade-offs

| Design Choice | Approach Taken | Trade-offs | Alternative Explored |
| :--- | :--- | :--- | :--- |
| **Primary Store Indexing** | PostgreSQL with B-tree index on `LIKE 'prefix%'`. | **Pros**: Relational ACID database stability, low memory footprints.<br>**Cons**: Disk lookup overhead on cache misses. | **In-memory Trie**: Faster lookups but huge RAM cost (~300MB at startup) and complex multi-server syncing. |
| **Distributed Caching** | Redis using a custom consistent hashing ring. | **Pros**: Scales gracefully, minimizes eviction on node additions/removals.<br>**Cons**: Hash ring computation overhead. | **Modulo Caching (`hash % N`)**: Simpler but causes $100\%$ cache misses on cluster resize. |
| **Trending Scoring** | Sliding 1-hour window with exponential time-decay. | **Pros**: Smooth decay, avoids permanent over-ranking of historic spikes.<br>**Cons**: In-memory storage of time buckets. | **Fixed Windowing**: Simpler but suffers from abrupt drop-offs at bucket borders. |
| **Write Optimization** | In-memory batch queue + single multi-row SQL upsert. | **Pros**: Saves over $45\%$ database write overhead via aggregation.<br>**Cons**: Unflushed searches are lost on sudden server crash. | **Direct Writes**: Safe from data loss but chokes database IOPS under heavy user traffic. |

---

## 5. Performance Report

A baseline benchmark conducted across **130 request samples** yielded the following statistics:

* **Cache Hit Latency (p50: 1.52 ms)**: Autocomplete prefixes served directly from the distributed Redis ring return instantly, guaranteeing lag-free recommendations.
* **Cache Miss Latency (p95: 395.28 ms)**: Database fallbacks run efficiently using PostgreSQL B-tree index scans. Tail latency spikes are primarily caused by Neon serverless cold starts.
* **Batch Writer Efficiency (45.8% Write Reduction)**: Aggregating increments reduced raw write volume by $45.8\%$ by consolidating duplicate writes inside a 10-second window.
* **Cache Consistency**: suggestion lookups dynamically merge counts from `batchWriter.buffer` in real-time, preventing autocomplete suggestion count lag before flushes.

import './env.js';
import express from 'express';

import * as db from './db.js';
import cache from './cache.js';
import { trendingTracker } from './trending.js';
import { batchWriter } from './batchWriter.js';
import * as logger from './logger.js';

import suggestRoute from './routes/suggest.js';
import searchRoute from './routes/search.js';
import cacheDebugRoute from './routes/cacheDebug.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(logger.timingMiddleware);

// allow cross-origin requests
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'search-typeahead-api' });
});

// trending endpoint
app.get('/trending', (req, res) => {
  const trending = trendingTracker.getTopTrending(10);
  res.json({ trending });
});

// stats endpoint
app.get('/stats', (req, res) => {
  res.json({
    cache: cache.getStats(),
    batchWriter: batchWriter.getStats(),
    trending: trendingTracker.getInfo(),
    latency: logger.getLatencyStats()
  });
});

// mount routes
app.use('/suggest', suggestRoute);
app.use('/search', searchRoute);
app.use('/cache/debug', cacheDebugRoute);

// start DB, cache and servers
await db.connect();
await cache.connect();
batchWriter.start();
trendingTracker.start();

app.listen(PORT, () => {
  console.log(`listening to port ${PORT}`);
});

// graceful shutdown — flush pending writes before exiting
async function shutdown(signal) {
  console.log(`\n[Shutdown] Received ${signal}, flushing pending writes...`);
  batchWriter.stop();
  trendingTracker.stop();

  try {
    await batchWriter.flush();
    console.log('[Shutdown] Batch writer flushed successfully');
  } catch (err) {
    console.error('[Shutdown] Batch writer flush failed:', err.message);
  }

  await cache.close();
  await db.close();
  console.log('[Shutdown] Cleanup complete, exiting');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

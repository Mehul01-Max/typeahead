import './env.js';
import express from 'express';
import path from 'path';

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

// serve react build (production)
app.use(express.static(path.join(import.meta.dirname, '..', 'client', 'dist')));

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

// catch-all: serve react app for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(import.meta.dirname, '..', 'client', 'dist', 'index.html'));
});

// start DB, cache and servers
await db.connect();
await cache.connect();
batchWriter.start();
trendingTracker.start();

app.listen(PORT, () => {
  console.log(`listening to port ${PORT}`);
});

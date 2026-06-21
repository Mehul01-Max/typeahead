import express from 'express';
import cache from '../cache.js';
import { batchWriter } from '../batchWriter.js';
import { trendingTracker } from '../trending.js';
import * as logger from '../logger.js';

const router = express.Router();

/*
  GET /cache/debug?prefix=<prefix>
  - Shows which cache node is responsible for a prefix
  - Shows whether it's a cache hit or miss
  - Shows consistent hashing ring info
*/
router.get('/', async (req, res) => {
  const prefix = (req.query.prefix || '').toLowerCase().trim();

  if (!prefix) {
    return res.status(400).json({ error: 'prefix query parameter is required' });
  }

  try {
    const debugInfo = await cache.getDebugInfo(prefix);
    const cacheStats = cache.getStats();
    const batchStats = batchWriter.getStats();
    const trendingInfo = trendingTracker.getInfo();
    const latencyStats = logger.getLatencyStats();

    res.json({
      cacheDebug: debugInfo,
      cacheStats,
      batchWriterStats: batchStats,
      trendingInfo,
      latencyStats
    });
  } catch (err) {
    console.error('[CacheDebug] Error:', err.message);
    res.status(500).json({ error: 'Failed to get debug info' });
  }
});

export default router;

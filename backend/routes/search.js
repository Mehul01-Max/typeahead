import express from 'express';
import { batchWriter } from '../batchWriter.js';
import { trendingTracker } from '../trending.js';
import cache from '../cache.js';

const router = express.Router();

/*
  POST /search
  - Accepts a search query, adds it to the batch writer buffer
  - Records the search in the trending tracker
  - Invalidates cache prefixes immediately for instant ranking feedback
  - Returns a dummy "Searched" response
*/
router.post('/', async (req, res) => {
  const query = (req.body.query || '').toLowerCase().trim();

  if (!query) {
    return res.status(400).json({ error: 'Query is required' });
  }

  // add to batch buffer (will be flushed to DB later)
  batchWriter.addToBatch(query);

  // record in trending tracker for recency scoring
  trendingTracker.recordSearch(query);

  try {
    // Invalidate prefix cache keys immediately so suggestion rankings refresh instantly
    await cache.invalidateForQuery(query);
  } catch (err) {
    console.error('[Search] Cache invalidation error:', err.message);
  }

  res.json({ message: 'Searched', query });
});

export default router;

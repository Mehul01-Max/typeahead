import express from 'express';
import * as db from '../db.js';
import cache from '../cache.js';
import { trendingTracker } from '../trending.js';

const router = express.Router();

/*
  GET /suggest?q=<prefix>
  - Returns top 10 suggestions matching the prefix
  - Checks cache first, falls back to database
  - Applies trending scores for recency-aware ranking
*/
router.get('/', async (req, res) => {
  const start = process.hrtime.bigint();
  const prefix = (req.query.q || '').toLowerCase().trim();

  if (!prefix) {
    return res.json({ suggestions: [], source: 'empty', latencyMs: 0 });
  }

  try {
    // step 1: check cache
    const cached = await cache.get(prefix);
    if (cached) {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      return res.json({
        suggestions: cached,
        source: 'cache',
        latencyMs: parseFloat(durationMs.toFixed(2))
      });
    }

    // step 2: cache miss — get from database
    const dbResults = await db.getTopByPrefix(prefix);
    let results = dbResults.map(item => ({
      query: item.query,
      count: parseInt(item.count, 10)
    }));

    // step 3: apply trending scores
    results = results.map(item => {
      const trendingScore = trendingTracker.getTrendingScore(item.query, item.count);
      return { ...item, trendingScore };
    });

    // re-sort by trending score
    results.sort((a, b) => b.trendingScore - a.trendingScore);

    // keep top 10
    results = results.slice(0, 10);

    // step 4: store in cache
    await cache.set(prefix, results, 60);

    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    res.json({
      suggestions: results,
      source: 'db',
      latencyMs: parseFloat(durationMs.toFixed(2))
    });

  } catch (err) {
    console.error('[Suggest] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch suggestions' });
  }
});

export default router;

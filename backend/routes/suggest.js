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

    // step 2: cache miss — get candidate suggestions
    // Fetch top 100 queries by count to allow trending items to bubble up
    const dbResults = await db.getTopByPrefix(prefix, 100);
    
    // Get unique queries matching the prefix from the active trending window
    const recentQueries = trendingTracker.getRecentQueriesByPrefix(prefix);

    // Merge database candidates and recent in-memory candidates
    const candidateMap = new Map();
    for (const item of dbResults) {
      candidateMap.set(item.query, parseInt(item.count, 10));
    }
    for (const query of recentQueries) {
      if (!candidateMap.has(query)) {
        candidateMap.set(query, 0); // initial count 0 for queries not yet flushed or in top 100
      }
    }

    // Compute trending scores for all candidates
    let results = [];
    for (const [query, count] of candidateMap.entries()) {
      const trendingScore = trendingTracker.getTrendingScore(query, count);
      results.push({ query, count, trendingScore });
    }

    // Sort by trending score in descending order
    results.sort((a, b) => b.trendingScore - a.trendingScore);

    // Keep the top 10 results
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

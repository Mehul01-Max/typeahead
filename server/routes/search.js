import express from 'express';
import { batchWriter } from '../batchWriter.js';
import { trendingTracker } from '../trending.js';

const router = express.Router();

/*
  POST /search
  - Accepts a search query, adds it to the batch writer buffer
  - Records the search in the trending tracker
  - Returns a dummy "Searched" response
*/
router.post('/', (req, res) => {
  const query = (req.body.query || '').toLowerCase().trim();

  if (!query) {
    return res.status(400).json({ error: 'Query is required' });
  }

  // add to batch buffer (will be flushed to DB later)
  batchWriter.addToBatch(query);

  // record in trending tracker for recency scoring
  trendingTracker.recordSearch(query);

  res.json({ message: 'Searched', query });
});

export default router;

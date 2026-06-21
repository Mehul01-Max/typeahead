const DECAY_LAMBDA = 0.05;        // controls decay speed, half-life ~14 min
const BUCKET_DURATION_MS = 60000; // 1 minute per bucket
const MAX_WINDOW_MS = 3600000;    // keep last 60 minutes of data
const CLEANUP_INTERVAL_MS = 60000;

export default class TrendingTracker {
  constructor() {
    this.buckets = [];  // [{timestamp, counts: Map<query, count>}]
    this.cleanupTimer = null;
  }

  start() {
    // periodically clean old buckets
    this.cleanupTimer = setInterval(() => {
      this._cleanOldBuckets();
    }, CLEANUP_INTERVAL_MS);
  }

  stop() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }

  // record a search event
  recordSearch(query) {
    const now = Date.now();
    let currentBucket = this.buckets[this.buckets.length - 1];

    // create new bucket if none exists or current one is too old
    if (!currentBucket || (now - currentBucket.timestamp) > BUCKET_DURATION_MS) {
      currentBucket = { timestamp: now, counts: new Map() };
      this.buckets.push(currentBucket);
    }

    const prev = currentBucket.counts.get(query) || 0;
    currentBucket.counts.set(query, prev + 1);
  }

  // compute trending score for a query
  // baseCount = the all-time count from the database
  getTrendingScore(query, baseCount) {
    const now = Date.now();
    let recentBoost = 0;

    for (const bucket of this.buckets) {
      const ageMinutes = (now - bucket.timestamp) / 60000;
      const count = bucket.counts.get(query) || 0;

      if (count > 0) {
        // exponential decay: recent searches count more
        const decayFactor = Math.exp(-DECAY_LAMBDA * ageMinutes);
        recentBoost += count * decayFactor * 10000; // scale up so it matters
      }
    }

    return baseCount + recentBoost;
  }

  // get top trending queries (most recent activity)
  getTopTrending(limit = 10) {
    const now = Date.now();
    const queryScores = new Map();

    for (const bucket of this.buckets) {
      const ageMinutes = (now - bucket.timestamp) / 60000;
      const decayFactor = Math.exp(-DECAY_LAMBDA * ageMinutes);

      for (const [query, count] of bucket.counts) {
        const prev = queryScores.get(query) || 0;
        queryScores.set(query, prev + count * decayFactor);
      }
    }

    // sort by score and return top N
    return Array.from(queryScores.entries())
      .map(([query, score]) => ({ query, trendingScore: Math.round(score * 100) / 100 }))
      .sort((a, b) => b.trendingScore - a.trendingScore)
      .slice(0, limit);
  }

  // remove buckets older than the window
  _cleanOldBuckets() {
    const cutoff = Date.now() - MAX_WINDOW_MS;
    const before = this.buckets.length;
    this.buckets = this.buckets.filter(b => b.timestamp > cutoff);
    const removed = before - this.buckets.length;
    if (removed > 0) {
      console.log(`[Trending] Cleaned ${removed} old buckets`);
    }
  }

  // for debugging
  getInfo() {
    return {
      activeBuckets: this.buckets.length,
      windowMinutes: MAX_WINDOW_MS / 60000,
      decayLambda: DECAY_LAMBDA,
      halfLifeMinutes: Math.round(Math.log(2) / DECAY_LAMBDA)
    };
  }
}

export const trendingTracker = new TrendingTracker();

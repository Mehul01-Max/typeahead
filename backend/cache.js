import { createClient } from 'redis';
import ConsistentHash from './consistentHash.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const NODE_COUNT = parseInt(process.env.CACHE_NODE_COUNT) || 3;
const DEFAULT_TTL = parseInt(process.env.CACHE_TTL_SECONDS) || 60;

let redisClient = null;
const hashRing = new ConsistentHash(150);

// stats tracking
const stats = {
  hits: 0,
  misses: 0,
  sets: 0
};

async function connect() {
  redisClient = createClient({ url: REDIS_URL });
  redisClient.on('error', (err) => console.error('[Cache] Redis error:', err));
  await redisClient.connect();

  // register logical cache nodes on the ring
  for (let i = 0; i < NODE_COUNT; i++) {
    hashRing.addNode(`node${i}`);
  }

  console.log(`[Cache] Connected to Redis, ${NODE_COUNT} logical nodes on ring`);
}

// build the full redis key with node prefix
function _buildKey(prefix) {
  const node = hashRing.getNode(prefix);
  return { node, key: `${node}:${prefix}` };
}

// get cached suggestions for a prefix
async function get(prefix) {
  const { key } = _buildKey(prefix);
  const data = await redisClient.get(key);

  if (data) {
    stats.hits++;
    return JSON.parse(data);
  }

  stats.misses++;
  return null;
}

// store suggestions in cache with TTL
async function set(prefix, results, ttl = DEFAULT_TTL) {
  const { key } = _buildKey(prefix);
  await redisClient.setEx(key, ttl, JSON.stringify(results));
  stats.sets++;
}

// remove a cached prefix (called when data changes)
async function invalidate(prefix) {
  const { key } = _buildKey(prefix);
  await redisClient.del(key);
}

// invalidate all keys that could be affected by a query update
async function invalidateForQuery(query) {
  // invalidate all prefixes of this query
  for (let i = 1; i <= query.length; i++) {
    const prefix = query.substring(0, i);
    await invalidate(prefix);
  }
}

// get debug info about a prefix's cache routing
async function getDebugInfo(prefix) {
  const { node, key } = _buildKey(prefix);
  const data = await redisClient.get(key);
  const ttl = await redisClient.ttl(key);

  // count keys per node
  const nodeKeyCounts = {};
  for (let i = 0; i < NODE_COUNT; i++) {
    const keys = await redisClient.keys(`node${i}:*`);
    nodeKeyCounts[`node${i}`] = keys.length;
  }

  return {
    prefix,
    assignedNode: node,
    redisKey: key,
    cacheStatus: data ? 'HIT' : 'MISS',
    ttlRemaining: ttl > 0 ? ttl : null,
    hashInfo: hashRing.getDebugInfo(prefix),
    nodeKeyCounts,
    globalStats: { ...stats }
  };
}

function getStats() {
  const total = stats.hits + stats.misses;
  return {
    ...stats,
    hitRate: total > 0 ? ((stats.hits / total) * 100).toFixed(1) + '%' : '0%'
  };
}

async function close() {
  if (redisClient) {
    await redisClient.quit();
    console.log('[Cache] Redis connection closed');
  }
}

export default {
  connect,
  get,
  set,
  invalidate,
  invalidateForQuery,
  getDebugInfo,
  getStats,
  close
};

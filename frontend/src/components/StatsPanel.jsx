import React, { useState, useEffect } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/*
  StatsPanel component
  - Fetches system stats from /stats endpoint
  - Shows cache hit rate, latency, batch writer info
  - Auto-refreshes every 3 seconds
*/

function StatsPanel() {
  const [stats, setStats] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 3000);
    return () => clearInterval(interval);
  }, []);

  async function fetchStats() {
    try {
      const res = await fetch(`${API_URL}/stats`);
      const data = await res.json();
      setStats(data);
    } catch (err) {
      // server might not be running yet
    }
  }

  if (!stats) return null;

  return (
    <div className="stats-panel">
      <h3 onClick={() => setExpanded(!expanded)} style={{ cursor: 'pointer' }}>
        📊 System Stats {expanded ? '▼' : '▶'}
      </h3>

      {expanded && (
        <div className="stats-content">
          <div className="stat-group">
            <h4>Cache</h4>
            <p>Hit Rate: <strong>{stats.cache.hitRate}</strong></p>
            <p>Hits: {stats.cache.hits} | Misses: {stats.cache.misses}</p>
          </div>

          <div className="stat-group">
            <h4>Latency</h4>
            <p>p50: <strong>{stats.latency.p50}</strong></p>
            <p>p95: <strong>{stats.latency.p95}</strong></p>
            <p>Avg: {stats.latency.avg}</p>
            <p>Samples: {stats.latency.sampleCount}</p>
          </div>

          <div className="stat-group">
            <h4>Batch Writer</h4>
            <p>Pending: {stats.batchWriter.pendingInBuffer}</p>
            <p>Total Searches: {stats.batchWriter.totalSearchesReceived}</p>
            <p>DB Writes: {stats.batchWriter.totalDbWrites}</p>
            <p>Write Reduction: <strong>{stats.batchWriter.writeReduction}</strong></p>
          </div>

          <div className="stat-group">
            <h4>Trending</h4>
            <p>Active Buckets: {stats.trending.activeBuckets}</p>
            <p>Window: {stats.trending.windowMinutes} min</p>
            <p>Half-life: {stats.trending.halfLifeMinutes} min</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default StatsPanel;

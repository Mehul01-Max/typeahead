import * as db from './db.js';
import cache from './cache.js';

const FLUSH_INTERVAL_MS = parseInt(process.env.BATCH_FLUSH_INTERVAL_MS) || 10000;
const MAX_BUFFER_SIZE = parseInt(process.env.BATCH_MAX_BUFFER_SIZE) || 50;

export default class BatchWriter {
  constructor() {
    this.buffer = new Map();  // query -> pending count
    this.flushTimer = null;
    this.flushing = false;    // guard against concurrent flushes

    // stats
    this.totalSearches = 0;
    this.totalFlushes = 0;
    this.totalDbWrites = 0;
  }

  start() {
    this.flushTimer = setInterval(() => {
      this.flush();
    }, FLUSH_INTERVAL_MS);
    console.log(`[BatchWriter] Started, flushing every ${FLUSH_INTERVAL_MS / 1000}s or at ${MAX_BUFFER_SIZE} entries`);
  }

  stop() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  // add a search to the buffer (not writing to DB yet)
  addToBatch(query) {
    this.totalSearches++;
    const current = this.buffer.get(query) || 0;
    this.buffer.set(query, current + 1);

    // flush if buffer is large enough
    if (this.buffer.size >= MAX_BUFFER_SIZE && !this.flushing) {
      console.log(`[BatchWriter] Buffer full (${this.buffer.size} entries), flushing early`);
      this.flush();
    }
  }

  // write all buffered counts to Database in one bulk operation
  async flush() {
    if (this.buffer.size === 0 || this.flushing) return;

    // snapshot and clear buffer atomically (synchronous)
    // new searches arriving during the async DB write go into a fresh buffer
    this.flushing = true;
    const snapshot = new Map(this.buffer);
    this.buffer.clear();

    const entries = [];
    for (const [query, count] of snapshot) {
      entries.push({ query, count });
    }

    const totalBufferedCount = entries.reduce((sum, e) => sum + e.count, 0);

    try {
      // bulk write to Database
      await db.batchUpsert(entries);
      this.totalFlushes++;
      this.totalDbWrites += entries.length;

      // invalidate cache for affected prefixes
      for (const { query } of entries) {
        await cache.invalidateForQuery(query);
      }

      console.log(
        `[BatchWriter] Flushed: ${snapshot.size} unique queries, ` +
        `${totalBufferedCount} total searches → ${entries.length} DB writes ` +
        `(saved ${totalBufferedCount - entries.length} writes by aggregation)`
      );
    } catch (err) {
      console.error('[BatchWriter] Flush failed:', err.message);
      // re-merge snapshot back into buffer so data is not lost
      for (const [query, count] of snapshot) {
        const current = this.buffer.get(query) || 0;
        this.buffer.set(query, current + count);
      }
    } finally {
      this.flushing = false;
    }
  }

  getStats() {
    return {
      pendingInBuffer: this.buffer.size,
      totalSearchesReceived: this.totalSearches,
      totalFlushes: this.totalFlushes,
      totalDbWrites: this.totalDbWrites,
      writeReduction: this.totalSearches > 0
        ? ((1 - this.totalDbWrites / this.totalSearches) * 100).toFixed(1) + '%'
        : '0%'
    };
  }
}

export const batchWriter = new BatchWriter();

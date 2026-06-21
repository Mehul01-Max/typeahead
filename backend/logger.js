const latencies = [];
const MAX_SAMPLES = 1000; // keep last 1000 measurements

export function logRequest(method, path, durationMs, extra = {}) {
  if (extra.isSuggest) {
    latencies.push(durationMs);
    if (latencies.length > MAX_SAMPLES) {
      latencies.shift();
    }
  }

  const logLine = `[${new Date().toISOString()}] ${method} ${path} ${durationMs.toFixed(1)}ms`;
  if (extra.source) {
    console.log(`${logLine} (source: ${extra.source})`);
  } else {
    console.log(logLine);
  }
}

export function getLatencyStats() {
  if (latencies.length === 0) {
    return { p50: 0, p95: 0, avg: 0, sampleCount: 0 };
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const p50Index = Math.floor(sorted.length * 0.5);
  const p95Index = Math.floor(sorted.length * 0.95);
  const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;

  return {
    p50: sorted[p50Index].toFixed(2) + 'ms',
    p95: sorted[p95Index].toFixed(2) + 'ms',
    avg: avg.toFixed(2) + 'ms',
    sampleCount: sorted.length
  };
}

// express middleware to measure request duration
export function timingMiddleware(req, res, next) {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1e6;
    const isSuggest = req.originalUrl.startsWith('/suggest');
    logRequest(req.method, req.originalUrl, durationMs, { isSuggest });
  });

  next();
}

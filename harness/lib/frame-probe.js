/**
 * Frame-time probe, injected by the harness via addInitScript before any page
 * script runs.
 *
 * This lives in the harness, not the app, on purpose: a page that reports its
 * own smoothness is not evidence of smoothness. The app never reads or writes
 * this object.
 *
 * It records requestAnimationFrame deltas, which is what the frame-time gate is
 * actually about -- whether the browser delivered frames on schedule while the
 * app was doing work. Long-animation-frame entries are collected alongside so a
 * failure points at the offending script rather than just a number.
 */
(() => {
  const deltas = [];
  const longFrames = [];
  let lastTimestamp = 0;
  let rafId = 0;
  let running = false;
  let observer = null;

  function tick(timestamp) {
    if (lastTimestamp !== 0) deltas.push(timestamp - lastTimestamp);
    lastTimestamp = timestamp;
    if (running) rafId = requestAnimationFrame(tick);
  }

  function quantile(sorted, q) {
    if (sorted.length === 0) return NaN;
    const rank = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
    return sorted[rank];
  }

  window.__frameProbe = {
    start() {
      deltas.length = 0;
      longFrames.length = 0;
      lastTimestamp = 0;
      running = true;
      rafId = requestAnimationFrame(tick);
      try {
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            longFrames.push({
              duration: entry.duration,
              blockingDuration: entry.blockingDuration ?? 0,
            });
          }
        });
        observer.observe({ type: 'long-animation-frame', buffered: false });
      } catch {
        observer = null; // Not every build ships LoAF; the deltas still stand.
      }
    },

    stop() {
      running = false;
      cancelAnimationFrame(rafId);
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      // The first frames after a navigation include layout and first paint,
      // which no amount of application care can make fast. Dropping a fixed
      // warmup window keeps the measurement about steady-state animation.
      const WARMUP_FRAMES = 30;
      const measured = deltas.slice(WARMUP_FRAMES);
      const sorted = measured.slice().sort((a, b) => a - b);
      return {
        count: sorted.length,
        discardedWarmup: Math.min(WARMUP_FRAMES, deltas.length),
        // Wall-clock time the measured frames actually cover. A page whose
        // compositor idles delivers frames in starved bursts, so a healthy
        // percentile can sit on top of a sample spanning a fraction of the
        // window. Reporting the span lets the judge reject such a sample
        // instead of quoting a flattering number from it.
        spanMs: measured.reduce((total, delta) => total + delta, 0),
        p50: quantile(sorted, 0.5),
        p95: quantile(sorted, 0.95),
        p99: quantile(sorted, 0.99),
        max: sorted.length > 0 ? sorted[sorted.length - 1] : NaN,
        longFrames: longFrames.slice(0, 50),
        longFrameCount: longFrames.length,
        // Retained so a suspicious percentile can be re-derived from raw data
        // rather than taken on trust.
        deltas: measured,
      };
    },
  };
})();

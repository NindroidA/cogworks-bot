import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { MemoryWatchdog } from '../../../src/utils/monitoring/memoryWatchdog';

describe('MemoryWatchdog', () => {
  let wd: MemoryWatchdog;
  beforeEach(() => { wd = new MemoryWatchdog({ checkIntervalMs: 999999 }); });
  afterEach(() => { wd.stop(); });

  test('track map in stats', () => { wd.trackMap('t', () => 42); expect(wd.getStats().trackedMaps.t).toBe(42); });
  test('untrack removes from stats', () => { wd.trackMap('t', () => 42); wd.untrackMap('t'); expect(wd.getStats().trackedMaps.t).toBeUndefined(); });
  test('multiple maps', () => { wd.trackMap('a', () => 10); wd.trackMap('b', () => 20); const s = wd.getStats(); expect(s.trackedMaps.a).toBe(10); expect(s.trackedMaps.b).toBe(20); });
  test('throwing sizeFn returns -1', () => { wd.trackMap('x', () => { throw new Error(); }); expect(wd.getStats().trackedMaps.x).toBe(-1); });
  test('stats has heap info', () => { const s = wd.getStats(); expect(s.heapUsedMB).toBeGreaterThan(0); expect(s.heapTotalMB).toBeGreaterThan(0); expect(s.rssMB).toBeGreaterThan(0); });
  test('checkThresholds returns level', () => { expect(['ok','warn','critical']).toContain(wd.checkThresholds()); });
  test('start/stop idempotent', () => { wd.start(); wd.start(); wd.stop(); wd.stop(); });
  test('config defaults', () => { const w = new MemoryWatchdog(); expect(w.getStats()).toBeDefined(); w.stop(); });
  test('env override MEMORY_WARN_HEAP_PCT', () => {
    const orig = process.env.MEMORY_WARN_HEAP_PCT; process.env.MEMORY_WARN_HEAP_PCT = '70';
    const w = new MemoryWatchdog(); expect(w.getConfig().heapWarnPct).toBe(70); w.stop();
    process.env.MEMORY_WARN_HEAP_PCT = orig;
  });
});

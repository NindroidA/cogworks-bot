import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { JoinVelocityTracker } from '../../../../src/utils/baitChannel/joinVelocityTracker';

describe('JoinVelocityTracker', () => {
  let t: JoinVelocityTracker;
  beforeEach(() => { t = new JoinVelocityTracker(); });
  afterEach(() => { t.destroy(); });

  test('burst at threshold', () => { for (let i = 0; i < 5; i++) t.recordJoin('g1'); expect(t.isBurstActive('g1', 5, 60000)).toBe(true); });
  test('below threshold', () => { t.recordJoin('g1'); t.recordJoin('g1'); expect(t.isBurstActive('g1', 5, 60000)).toBe(false); });
  test('getJoinCount', () => { t.recordJoin('g1'); t.recordJoin('g1'); t.recordJoin('g1'); expect(t.getJoinCount('g1', 60000)).toBe(3); });
  test('unknown guild 0', () => { expect(t.getJoinCount('x', 60000)).toBe(0); });
  test('window expiry', async () => { t.recordJoin('g1'); await new Promise(r => setTimeout(r, 60)); expect(t.getJoinCount('g1', 30)).toBe(0); });
  test('cleanup runs', () => { t.recordJoin('g1'); t.cleanup(); expect(t.getTrackedGuildCount()).toBe(1); });
  test('destroy clears', () => { t.recordJoin('g1'); t.recordJoin('g2'); t.destroy(); expect(t.getTrackedGuildCount()).toBe(0); expect(t.getMapSize()).toBe(0); });
  test('destroy idempotent', () => { t.destroy(); t.destroy(); });
  test('guild count', () => { t.recordJoin('a'); t.recordJoin('b'); expect(t.getTrackedGuildCount()).toBe(2); });
  test('map size', () => { t.recordJoin('a'); t.recordJoin('a'); t.recordJoin('b'); expect(t.getMapSize()).toBe(3); });
  test('isolation', () => { for (let i = 0; i < 10; i++) t.recordJoin('ga'); t.recordJoin('gb'); expect(t.isBurstActive('ga', 5, 60000)).toBe(true); expect(t.isBurstActive('gb', 5, 60000)).toBe(false); });
  test('startCleanupInterval idempotent', () => { t.startCleanupInterval(); t.startCleanupInterval(); t.destroy(); });
});

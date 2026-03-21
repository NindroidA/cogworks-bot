import { describe, test, expect } from 'bun:test';
import { asyncPool, LegacyMigrationRunner } from '../../../src/utils/database/legacyMigration';
import type { LegacyMigration } from '../../../src/utils/database/legacyMigration';

const makeMigration = (o?: Partial<LegacyMigration>): LegacyMigration => ({
  id: 'test', description: 'Test', version: '1.0.0',
  detect: async () => true, migrate: async () => ({ success: true, changes: 1 }), ...o,
});

describe('asyncPool', () => {
  test('processes all', async () => {
    const r: number[] = [];
    await asyncPool(3, [1,2,3,4,5], async n => { r.push(n); });
    expect(r.sort()).toEqual([1,2,3,4,5]);
  });
  test('concurrency limit', async () => {
    let max = 0, cur = 0;
    await asyncPool(2, [1,2,3,4], async () => { cur++; max = Math.max(max, cur); await new Promise(r => setTimeout(r, 10)); cur--; });
    expect(max).toBeLessThanOrEqual(2);
  });
  test('empty array', async () => { await asyncPool(3, [], async () => {}); });
});

describe('LegacyMigrationRunner', () => {
  test('register valid', () => { const r = new LegacyMigrationRunner(); expect(() => r.register(makeMigration())).not.toThrow(); });
  test('reject duplicate', () => { const r = new LegacyMigrationRunner(); r.register(makeMigration()); expect(() => r.register(makeMigration())).toThrow('Duplicate'); });
  test('reject missing fields', () => { const r = new LegacyMigrationRunner(); expect(() => r.register(makeMigration({ id: '' }))).toThrow('missing'); });
  test('processes guilds', async () => {
    const m: string[] = []; const r = new LegacyMigrationRunner();
    r.register(makeMigration({ id: 'p', migrate: async g => { m.push(g); return { success: true, changes: 1 }; } }));
    const rpt = await r.runAll(['g1','g2']);
    expect(m.sort()).toEqual(['g1','g2']); expect(rpt.results[0].totalChanges).toBe(2);
  });
  test('skips non-detected', async () => {
    const r = new LegacyMigrationRunner(); r.register(makeMigration({ id: 's', detect: async () => false }));
    const rpt = await r.runAll(['g1']); expect(rpt.results[0].guildsSkipped).toBe(1);
  });
  test('handles failure', async () => {
    const r = new LegacyMigrationRunner(); r.register(makeMigration({ id: 'f', migrate: async () => { throw new Error('fail'); } }));
    const rpt = await r.runAll(['g1']); expect(rpt.results[0].guildsFailed).toBe(1);
  });
  test('dry run', async () => {
    let called = false; const r = new LegacyMigrationRunner({ dryRun: true });
    r.register(makeMigration({ id: 'd', migrate: async () => { called = true; return { success: true, changes: 1 }; } }));
    await r.runAll(['g1']); expect(called).toBe(false);
  });
  test('duration', async () => {
    const r = new LegacyMigrationRunner(); r.register(makeMigration({ id: 'dur', detect: async () => false }));
    const rpt = await r.runAll(['g1']); expect(rpt.durationMs).toBeGreaterThanOrEqual(0);
  });
});

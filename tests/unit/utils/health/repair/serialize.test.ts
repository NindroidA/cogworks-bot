/**
 * The internal API's view of a repair step: before and after per op. Sets are
 * covered end to end by the bot-health API suite; these are the ops a step can
 * take besides a set, and a finding without a lang string.
 */
import { describe, expect, test } from 'bun:test';
import { findingKey } from '../../../../../src/utils/health/repair/keys';
import { planRepairs } from '../../../../../src/utils/health/repair/planner';
import {
  serializePlan,
  serializeReport,
  serializeResults,
  serializeStep,
} from '../../../../../src/utils/health/repair/serialize';
import type { RepairStep } from '../../../../../src/utils/health/repair/types';
import { buildReport } from '../../../../../src/utils/health/runner';
import type { HealthFinding } from '../../../../../src/utils/health/types';
import { makeCheckContext } from '../../../../helpers/healthContext';

const G = '100000000000000001';
const FORUM = '300000000000000666';

const step = (o: Partial<RepairStep> & Pick<RepairStep, 'op' | 'entity'>): RepairStep => ({
  where: { guildId: G },
  guard: {},
  proofs: [],
  keys: ['aaaaaaaaaaaaaaaa'],
  ...o,
});

describe('serializeStep', () => {
  test('a delete shows the values that justify it and the tables it takes rows from', () => {
    const cascade = [
      { entity: 'MemoryItem' as const, column: 'memoryConfigId' },
      { entity: 'MemoryTag' as const, column: 'memoryConfigId' },
    ];
    const s = step({ op: 'delete', entity: 'MemoryConfig', where: { guildId: G, id: 3 }, guard: { forumChannelId: FORUM }, cascade });
    expect(serializeStep(s)).toEqual({
      entity: 'MemoryConfig',
      rowId: 3,
      op: 'delete',
      keys: s.keys,
      before: { forumChannelId: FORUM },
      after: null,
      cascade: ['MemoryItem', 'MemoryTag'],
    });
  });

  test("BotConfig's row is its guild; an insert and a command have no row", () => {
    const set = step({ op: 'set', entity: 'BotConfig', guard: { locale: 'jp' }, set: { locale: 'en' } });
    expect(serializeStep(set)).toMatchObject({ rowId: G, before: { locale: 'jp' }, after: { locale: 'en' } });

    const values = { name: 'maintenance', guildId: G };
    const insert = step({ op: 'insert', entity: 'AnnouncementTemplate', values });
    expect(serializeStep(insert)).toMatchObject({ rowId: null, before: null, after: values });

    const command = step({ op: 'command', entity: 'ApplicationCommand', command: 'registerGuildCommands' });
    expect(serializeStep(command)).toMatchObject({ rowId: null, before: null, after: null, command: 'registerGuildCommands' });
  });

  test('results carry the outcome but not the error text', () => {
    const s = step({ op: 'set', entity: 'XPConfig', where: { guildId: G, id: 5 }, guard: { a: 1 }, set: { a: 2 } });
    const counts = { applied: 0, stale: 0, gone: 0, exists: 0, 'skipped-not-missing': 0, 'skipped-unverified': 0, failed: 1 };
    const [result] = serializeResults({ results: [{ step: s, outcome: 'failed', error: 'ER_LOCK_DEADLOCK' }], counts });
    expect(result).toEqual({ ...serializeStep(s), outcome: 'failed' });
  });
});

describe('serializeReport', () => {
  test('a finding without a lang string shows its code, and nothing fixes it', () => {
    const finding: HealthFinding = {
      code: 'xp.config.not_a_code',
      system: 'xp',
      severity: 'degraded',
      repair: 'manual',
      entity: 'XPConfig',
      params: {},
    };
    const results = [{ checkId: 'xp.config', system: 'xp' as const, configured: true, findings: [finding] }];
    const report = buildReport(results, { guildId: G, botVersion: 'test', checkedAt: '', deep: false, notChecked: [] });
    const out = serializeReport(report, { fixes: [], steps: [], unsupported: [] });
    expect(out.systems.xp.findings).toEqual([
      { ...finding, key: findingKey(finding), text: 'xp.config.not_a_code', fixable: false, label: null },
    ]);
    expect(out.systems.xp.status).toBe('warn');
  });
});

describe('serializePlan', () => {
  test('a long list in a change arrives cut off, so 1000 findings on one list stay small', () => {
    const ids = Array.from({ length: 1000 }, (_, i) => String(300000000000000000n + BigInt(i)));
    const findings: HealthFinding[] = ids.map(id => ({
      code: 'xp.config.ignored_channel_missing',
      system: 'xp',
      severity: 'cosmetic',
      repair: 'auto',
      entity: 'XPConfig',
      rowId: 5,
      field: 'ignoredChannels',
      refId: id,
      params: { channelId: id },
    }));
    const xp = { id: 5, levelUpChannelId: null, ignoredChannels: ids, ignoredRoles: [], multiplierChannels: null };
    const results = [{ checkId: 'xp.config', system: 'xp' as const, configured: true, findings }];
    const report = buildReport(results, { guildId: G, botVersion: 'test', checkedAt: '', deep: false, notChecked: [] });
    const plan = planRepairs(report, makeCheckContext({ rows: { XPConfig: [xp] } }));
    expect(plan.fixes).toHaveLength(1000);

    const view = serializePlan(plan);
    const [change] = view.fixes[0].changes;
    expect(change.field).toBe('ignoredChannels');
    expect(typeof change.before).toBe('string');
    expect((change.before as string).length).toBe(200);
    expect((change.before as string).endsWith('…')).toBe(true);
    const size = JSON.stringify({ report: serializeReport(report, plan), plan: view }).length;
    // Full copies of the list in every fix came to over 40 MB.
    expect(size).toBeLessThan(1_500_000);
    // The plan itself still holds the full lists, which a dry run's merged step shows once.
    expect((plan.fixes[0].changes[0].before as string[]).length).toBe(1000);
  });

  test('short values pass through as they are', () => {
    const fix = {
      key: 'aaaaaaaaaaaaaaaa',
      code: 'core.locale.unsupported',
      label: 'x',
      system: 'core' as const,
      repair: 'auto' as const,
      entity: 'BotConfig' as const,
      op: 'set' as const,
      changes: [{ field: 'locale', before: 'jp', after: 'en' }],
    };
    expect(serializePlan({ fixes: [fix], steps: [], unsupported: [] }).fixes).toEqual([fix]);
  });
});

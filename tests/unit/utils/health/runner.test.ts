/**
 * Health check runner: isolation (a throwing check), DB errors never reading
 * as "not configured", system status and counts, entity scoping, and the
 * read-only guarantee against a messy legacy guild.
 */
import { describe, expect, test } from 'bun:test';
import { version } from '../../../../package.json';
import { CORE_CHECKS } from '../../../../src/utils/health/checks/core';
import type { HealthEntityName } from '../../../../src/utils/health/context';
import { repoRowLoader, rowsOf } from '../../../../src/utils/health/context';
import { defineCheck } from '../../../../src/utils/health/define';
import { runHealthCheck, systemStatus } from '../../../../src/utils/health/runner';
import type { HealthCheck, HealthFinding } from '../../../../src/utils/health/types';
import { FAKE_GUILD_ID, makeFakeGuild } from '../../../helpers/fakeGuild';
import { type FakeRepo, makeFakeRepo, writeCallCount } from '../../../helpers/fakeRepo';

const G = FAKE_GUILD_ID;
const STAFF = '200000000000000001';
const DELETED = '200000000000000666';

const emptyLoader = async () => [];

const ok = defineCheck({ id: 'test.ok', system: 'ticket', entities: ['BotConfig'], names: [] }, () => []);
const boom = defineCheck({ id: 'test.boom', system: 'ticket', entities: ['StaffRole'], names: [] }, () => {
  throw new Error('kaboom');
});
const warns = defineCheck({ id: 'test.warns', system: 'rules', entities: [], names: ['bad'] }, (_ctx, emit) => [
  emit('bad', 'cosmetic', 'confirm', { entity: 'RulesConfig' }),
]);
const unconfigured = defineCheck(
  { id: 'test.unconfigured', system: 'memory', entities: ['SetupState'], names: [], isConfigured: () => false },
  () => [],
);

describe('runHealthCheck', () => {
  test('a throwing check yields one <id>.error finding and the run continues', async () => {
    const report = await runHealthCheck(makeFakeGuild(), {}, { checks: [boom, ok, warns], loadRows: emptyLoader });
    expect(report.systems.ticket?.findings).toEqual([
      {
        code: 'test.boom.error',
        system: 'ticket',
        severity: 'degraded',
        repair: 'manual',
        entity: 'StaffRole',
        params: {},
      },
    ]);
    expect(report.systems.ticket?.status).toBe('warn');
    expect(report.systems.rules?.findings.map(f => f.code)).toEqual(['test.warns.bad']);
  });

  test('a DB load failure is an error finding, never "not configured"', async () => {
    const loader = async (entity: HealthEntityName) => {
      if (entity === 'SetupState') throw new Error('ECONNREFUSED');
      return [];
    };
    const reads = defineCheck(
      { id: 'test.reads', system: 'memory', entities: ['SetupState'], names: [], isConfigured: () => false },
      ctx => {
        rowsOf(ctx, 'SetupState'); // throws: the load failed
        return [];
      },
    );
    const report = await runHealthCheck(makeFakeGuild(), {}, { checks: [reads], loadRows: loader });
    expect(report.systems.memory?.status).toBe('warn');
    expect(report.systems.memory?.findings.map(f => f.code)).toEqual(['test.reads.error']);
  });

  test('the real core checks surface a failed StaffRole load as core.staff_role.error', async () => {
    const loader = async (entity: HealthEntityName) => {
      if (entity === 'StaffRole') throw new Error('ER_LOCK_WAIT_TIMEOUT');
      return [];
    };
    // CORE_CHECKS, not the registry: the command sync check needs Discord (see commandsCheck.test.ts).
    const report = await runHealthCheck(makeFakeGuild(), { system: 'core' }, { checks: CORE_CHECKS, loadRows: loader });
    expect(report.systems.core?.findings.map(f => f.code)).toEqual(['core.staff_role.error']);
    expect(report.systems.core?.status).toBe('warn');
  });

  test('status: not_configured only when no check is configured and nothing was found', async () => {
    const report = await runHealthCheck(makeFakeGuild(), {}, { checks: [unconfigured, ok], loadRows: emptyLoader });
    expect(report.systems.memory?.status).toBe('not_configured');
    expect(report.systems.ticket?.status).toBe('ok');
  });

  test('systemStatus: block → fail, any other finding → warn', () => {
    const f = (severity: HealthFinding['severity']) => ({ severity }) as HealthFinding;
    expect(systemStatus([f('cosmetic'), f('block')], true)).toBe('fail');
    expect(systemStatus([f('degraded')], false)).toBe('warn');
    expect(systemStatus([], true)).toBe('ok');
    expect(systemStatus([], false)).toBe('not_configured');
  });

  test('a check only sees the entities it declared', async () => {
    const sneaky = defineCheck({ id: 'test.sneaky', system: 'ticket', entities: ['StaffRole'], names: [] }, ctx => {
      if (ctx.rows.BotConfig !== undefined) throw new Error('saw an undeclared entity');
      return [];
    });
    const report = await runHealthCheck(makeFakeGuild(), {}, { checks: [ok, sneaky], loadRows: emptyLoader });
    expect(report.systems.ticket?.findings).toEqual([]);
  });

  test('system filter runs and loads only that system', async () => {
    const loaded: string[] = [];
    const loader = async (entity: HealthEntityName) => {
      loaded.push(entity);
      return [];
    };
    const report = await runHealthCheck(
      makeFakeGuild(),
      { system: 'rules' },
      { checks: [ok, boom, warns], loadRows: loader },
    );
    expect(Object.keys(report.systems)).toEqual(['rules']);
    expect(loaded).toEqual([]);
  });

  test('report metadata, counts, notChecked, and JSON round-trip', async () => {
    const report = await runHealthCheck(
      makeFakeGuild({ available: false, botPermissions: null }),
      { deep: true },
      { checks: [boom, warns], loadRows: emptyLoader },
    );
    expect(report.guildId).toBe(G);
    expect(report.botVersion).toBe(version);
    expect(new Date(report.checkedAt).toISOString()).toBe(report.checkedAt);
    expect(report.deep).toBe(true);
    expect(report.counts).toEqual({ auto: 0, confirm: 1, manual: 1 });
    expect(report.notChecked).toEqual(['guild-cache-unavailable', 'bot-member-unavailable']);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  test('REST calls skipped over budget are listed in notChecked', async () => {
    const greedy: HealthCheck = {
      id: 'test.greedy',
      system: 'ticket',
      entities: [],
      codes: [],
      async run(ctx) {
        await Promise.all(Array.from({ length: 62 }, (_, i) => ctx.rest.fetch(`message:${i}`, async () => ({}))));
        return [];
      },
    };
    const report = await runHealthCheck(makeFakeGuild(), {}, { checks: [greedy], loadRows: emptyLoader });
    expect(report.notChecked).toEqual(['rest:message:60', 'rest:message:61']);
  });

  test('low-priority checks start after the others finish, and the report keeps registry order', async () => {
    const calls: string[] = [];
    const lookups = (label: string, count: number) => async (ctx: Parameters<HealthCheck['run']>[0]) => {
      for (let i = 0; i < count; i++) await ctx.rest.fetch(label, async () => calls.push(label));
      return [];
    };
    const late = defineCheck(
      { id: 'test.late', system: 'memory', entities: [], names: ['cosmetic'], restPriority: 'low' },
      async (ctx, emit) => [...(await lookups('late', 3)(ctx)), emit('cosmetic', 'cosmetic', 'auto', { entity: 'X' })],
    );
    const early = defineCheck({ id: 'test.early', system: 'rules', entities: [], names: [] }, lookups('early', 3));
    const report = await runHealthCheck(makeFakeGuild(), {}, { checks: [late, early], loadRows: emptyLoader });
    expect(calls).toEqual(['early', 'early', 'early', 'late', 'late', 'late']);
    expect(Object.keys(report.systems)).toEqual(['memory', 'rules']);
    expect(report.systems.memory?.findings.map(f => f.code)).toEqual(['test.late.cosmetic']);
  });
});

describe('read-only guarantee (messy legacy guild, real core checks, real repo loader)', () => {
  function repos(): Record<string, FakeRepo> {
    return {
      BotConfig: makeFakeRepo([
        { id: G, guildId: G, enableGlobalStaffRole: true, globalStaffRole: `<@&${DELETED}>`, locale: 'jp' },
      ]),
      StaffRole: makeFakeRepo([
        { id: 1, guildId: G, type: 'staff', role: `<@&${STAFF}>`, alias: 'Mods' },
        { id: 2, guildId: G, type: 'staff', role: STAFF, alias: 'Mods' },
        { id: 3, guildId: G, type: 'admin', role: DELETED, alias: 'Old' },
        { id: 4, guildId: 'another-guild', type: 'staff', role: DELETED, alias: 'Not ours' },
      ]),
      GuildPermission: makeFakeRepo([
        { id: 1, guildId: G, feature: 'insights', level: 'use', roleId: STAFF },
        { id: 2, guildId: G, feature: 'tickets', level: 'admin', roleId: G },
        { id: 3, guildId: G, feature: 'xp', level: 'manage', roleId: DELETED },
      ]),
      SetupState: makeFakeRepo([{ id: 1, guildId: G, selectedSystems: ['ticket', 'insights'] }]),
    };
  }

  test('finds every legacy problem, stays guild-scoped, and never writes', async () => {
    const fakes = repos();
    const loader = repoRowLoader(target => fakes[(target as { name: string }).name]);
    const guild = makeFakeGuild({ roles: [{ id: STAFF, mentionable: true }] });

    const report = await runHealthCheck(guild, {}, { checks: CORE_CHECKS, loadRows: loader });

    expect(report.systems.core?.findings.map(f => f.code).sort()).toEqual(
      [
        'core.global_staff_role.missing',
        'core.locale.unsupported',
        'core.staff_role.format_legacy',
        'core.staff_role.duplicate',
        'core.staff_role.missing',
        'core.guild_permission.unknown_feature',
        'core.guild_permission.everyone',
        'core.guild_permission.missing_role',
        'core.setup_state.unknown_system',
      ].sort(),
    );
    // Nothing here blocks: the worst findings (global staff role deleted, @everyone grant) are degraded.
    expect(report.systems.core?.status).toBe('warn');
    // Rows from another guild never leak into the report.
    expect(report.systems.core?.findings.some(f => f.params.alias === 'Not ours')).toBe(false);

    for (const [name, repo] of Object.entries(fakes)) {
      expect({ name, writes: writeCallCount(repo) }).toEqual({ name, writes: 0 });
      // Exactly one guild-scoped find per entity, even though BotConfig is declared by two checks.
      expect({ name, finds: repo.findCalls }).toEqual({ name, finds: [{ where: { guildId: G } }] });
      expect(repo.findOneByCalls).toEqual([]);
      expect(repo.qbCalls).toEqual([]);
    }
  });
});

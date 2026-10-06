/**
 * Core health checks (BotConfig, StaffRole, GuildPermission, SetupState):
 * pure functions over a plain-object CheckContext, one pass and one or more
 * fail cases per check.
 */
import { describe, expect, test } from 'bun:test';
import { PermissionFlagsBits } from 'discord.js';
import { SUPPORTED_LOCALES } from '../../../../src/lang';
import type { LoadedRows } from '../../../../src/utils/health/context';
import { getChecks } from '../../../../src/utils/health/registry';
import { runCheck } from '../../../../src/utils/health/runner';
import type { HealthFinding } from '../../../../src/utils/health/types';
import { FAKE_GUILD_ID, type FakeGuildInit, makeFakeGuild } from '../../../helpers/fakeGuild';
import { makeCheckContext } from '../../../helpers/healthContext';

const G = FAKE_GUILD_ID;
const STAFF = '200000000000000001';
const ADMIN = '200000000000000002';
const DELETED = '200000000000000666';
const MUTED = '200000000000000003'; // exists but not mentionable

const ROLES: FakeGuildInit['roles'] = [
  { id: STAFF, mentionable: true },
  { id: ADMIN, mentionable: true },
  { id: MUTED, mentionable: false },
];

/** Runs one registered check (through runCheck, so it only sees the entities it declared). */
async function run(checkId: string, rows: LoadedRows, guild: FakeGuildInit = {}): Promise<HealthFinding[]> {
  const check = getChecks().find(c => c.id === checkId);
  if (!check) throw new Error(`no check ${checkId}`);
  const ctx = makeCheckContext({ guild: makeFakeGuild({ roles: ROLES, ...guild }), rows });
  const result = await runCheck(check, ctx);
  return result.findings;
}

const codes = (findings: HealthFinding[]) => findings.map(f => f.code);

function botConfig(overrides: Record<string, unknown> = {}) {
  return { guildId: G, enableGlobalStaffRole: true, globalStaffRole: STAFF, locale: 'en', ...overrides };
}

describe('core.global_staff_role', () => {
  const id = 'core.global_staff_role';

  test('pass: raw id of an existing mentionable role', async () => {
    expect(await run(id, { BotConfig: [botConfig()] })).toEqual([]);
  });

  test('pass: no BotConfig row, or flag off with no role', async () => {
    expect(await run(id, { BotConfig: [] })).toEqual([]);
    expect(await run(id, { BotConfig: [botConfig({ enableGlobalStaffRole: false, globalStaffRole: null })] })).toEqual(
      [],
    );
  });

  test('fail: flag on without a role', async () => {
    const [f] = await run(id, { BotConfig: [botConfig({ globalStaffRole: null })] });
    expect(f).toMatchObject({
      code: 'core.global_staff_role.enabled_without_role',
      system: 'core',
      severity: 'degraded',
      repair: 'auto',
      entity: 'BotConfig',
      rowId: G,
      field: 'enableGlobalStaffRole',
    });
  });

  test('fail: legacy <@&id> mention format', async () => {
    const findings = await run(id, { BotConfig: [botConfig({ globalStaffRole: `<@&${STAFF}>` })] });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: 'core.global_staff_role.format_legacy',
      severity: 'cosmetic',
      repair: 'auto',
      refId: STAFF,
      params: { roleId: STAFF },
    });
  });

  test('fail: deleted role (either format) reports only missing', async () => {
    for (const value of [DELETED, `<@&${DELETED}>`]) {
      const findings = await run(id, { BotConfig: [botConfig({ globalStaffRole: value })] });
      expect(codes(findings)).toEqual(['core.global_staff_role.missing']);
      expect(findings[0]).toMatchObject({ severity: 'degraded', repair: 'auto', refId: DELETED });
    }
  });

  test('fail: deleted role with the flag off is only cosmetic (nothing reads it)', async () => {
    const findings = await run(id, {
      BotConfig: [botConfig({ globalStaffRole: DELETED, enableGlobalStaffRole: false })],
    });
    expect(codes(findings)).toEqual(['core.global_staff_role.missing']);
    expect(findings[0]).toMatchObject({ severity: 'cosmetic', repair: 'auto' });
  });

  test('pass: a role missing from an unavailable guild is not proof of deletion', async () => {
    expect(await run(id, { BotConfig: [botConfig({ globalStaffRole: DELETED })] }, { available: false })).toEqual([]);
  });

  test('fail: unparseable value', async () => {
    expect(codes(await run(id, { BotConfig: [botConfig({ globalStaffRole: 'Moderators' })] }))).toEqual([
      'core.global_staff_role.invalid',
    ]);
  });

  test('unparseable value with the flag off is only cosmetic', async () => {
    const [f] = await run(id, {
      BotConfig: [botConfig({ enableGlobalStaffRole: false, globalStaffRole: 'Moderators' })],
    });
    expect(f).toMatchObject({ code: 'core.global_staff_role.invalid', severity: 'cosmetic' });
  });

  test('fail: non-mentionable role and the bot lacks MentionEveryone', async () => {
    const findings = await run(id, { BotConfig: [botConfig({ globalStaffRole: MUTED })] });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: 'core.global_staff_role.not_mentionable',
      severity: 'degraded',
      repair: 'manual',
    });
  });

  test('pass: non-mentionable role is fine with MentionEveryone, Administrator, or the flag off', async () => {
    const rows = { BotConfig: [botConfig({ globalStaffRole: MUTED })] };
    expect(await run(id, rows, { botPermissions: [PermissionFlagsBits.MentionEveryone] })).toEqual([]);
    expect(await run(id, rows, { botPermissions: [PermissionFlagsBits.Administrator] })).toEqual([]);
    expect(await run(id, { BotConfig: [botConfig({ globalStaffRole: MUTED, enableGlobalStaffRole: false })] })).toEqual(
      [],
    );
  });
});

describe('core.locale', () => {
  test('pass: supported locales', async () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(await run('core.locale', { BotConfig: [botConfig({ locale })] })).toEqual([]);
    }
  });

  test('fail: unsupported locale', async () => {
    const [f] = await run('core.locale', { BotConfig: [botConfig({ locale: 'jp' })] });
    expect(f).toMatchObject({
      code: 'core.locale.unsupported',
      severity: 'cosmetic',
      repair: 'auto',
      field: 'locale',
      params: { locale: 'jp' },
    });
  });
});

describe('core.staff_role', () => {
  const id = 'core.staff_role';
  const row = (rowId: number, role: string, type = 'staff', alias = 'Mods') => ({
    id: rowId,
    guildId: G,
    type,
    role,
    alias,
  });

  test('pass: raw ids of existing roles', async () => {
    expect(await run(id, { StaffRole: [row(1, STAFF), row(2, ADMIN, 'admin')] })).toEqual([]);
  });

  test('fail: deleted role is a cosmetic dangling entry (channel creation skips it)', async () => {
    const [f] = await run(id, { StaffRole: [row(1, DELETED, 'staff', 'Old Mods')] });
    expect(f).toMatchObject({
      code: 'core.staff_role.missing',
      severity: 'cosmetic',
      repair: 'auto',
      entity: 'StaffRole',
      rowId: 1,
      refId: DELETED,
      params: { roleId: DELETED, alias: 'Old Mods' },
    });
  });

  test('fail: legacy mention format', async () => {
    expect(codes(await run(id, { StaffRole: [row(1, `<@&${STAFF}>`)] }))).toEqual(['core.staff_role.format_legacy']);
  });

  test('fail: same role saved twice in different formats → the newer row is the duplicate', async () => {
    const findings = await run(id, { StaffRole: [row(7, `<@&${STAFF}>`), row(3, STAFF)] });
    expect(codes(findings)).toEqual(['core.staff_role.duplicate']);
    expect(findings[0]).toMatchObject({ rowId: 7, refId: STAFF, params: { keptRowId: 3 } });
  });

  test('duplicate with a different alias needs confirmation (the alias would be lost)', async () => {
    const findings = await run(id, {
      StaffRole: [row(3, STAFF, 'staff', 'Mods'), row(7, `<@&${STAFF}>`, 'staff', 'Moderators')],
    });
    expect(findings[0]).toMatchObject({
      code: 'core.staff_role.duplicate',
      repair: 'confirm',
      params: { keptRowId: 3, keptAlias: 'Mods', alias: 'Moderators' },
    });
  });

  test('pass: the same role as both staff and admin is not a duplicate', async () => {
    expect(await run(id, { StaffRole: [row(1, STAFF, 'staff'), row(2, STAFF, 'admin')] })).toEqual([]);
  });

  test('fail: unparseable role and unknown type', async () => {
    const [invalid] = await run(id, { StaffRole: [row(1, 'Mods')] });
    expect(invalid).toMatchObject({ code: 'core.staff_role.invalid', severity: 'cosmetic', repair: 'confirm' });
    const [f] = await run(id, { StaffRole: [row(1, STAFF, 'mod')] });
    expect(f).toMatchObject({ code: 'core.staff_role.unknown_type', field: 'type', params: { type: 'mod' } });
  });
});

describe('core.guild_permission', () => {
  const id = 'core.guild_permission';
  const grant = (rowId: number, roleId: string, feature = 'tickets', level = 'manage') => ({
    id: rowId,
    guildId: G,
    roleId,
    feature,
    level,
  });

  test('pass: known feature and level on an existing role', async () => {
    expect(await run(id, { GuildPermission: [grant(1, STAFF), grant(2, ADMIN, 'xp', 'admin')] })).toEqual([]);
  });

  test('fail: unknown feature / level', async () => {
    expect(codes(await run(id, { GuildPermission: [grant(1, STAFF, 'insights')] }))).toEqual([
      'core.guild_permission.unknown_feature',
    ]);
    const [f] = await run(id, { GuildPermission: [grant(1, STAFF, 'tickets', 'owner')] });
    expect(f).toMatchObject({
      code: 'core.guild_permission.unknown_level',
      field: 'level',
      params: { level: 'owner' },
    });
  });

  test('fail: grant on a deleted role', async () => {
    const [f] = await run(id, { GuildPermission: [grant(4, DELETED)] });
    expect(f).toMatchObject({
      code: 'core.guild_permission.missing_role',
      severity: 'cosmetic',
      repair: 'auto',
      rowId: 4,
      field: 'roleId',
      refId: DELETED,
    });
  });

  test('fail: @everyone grant is a manual security warning, not a missing role', async () => {
    const findings = await run(id, { GuildPermission: [grant(5, G, 'tickets', 'admin')] });
    expect(codes(findings)).toEqual(['core.guild_permission.everyone']);
    expect(findings[0]).toMatchObject({
      severity: 'degraded',
      repair: 'manual',
      params: { feature: 'tickets', level: 'admin' },
    });
  });
});

describe('core.setup_state', () => {
  const id = 'core.setup_state';
  const state = (selectedSystems: unknown) => ({
    id: 9,
    guildId: G,
    selectedSystems,
    systemStates: null,
    partialData: null,
  });

  test('pass: known system ids, null selection, or no row', async () => {
    expect(await run(id, { SetupState: [state(['ticket', 'rules', 'reactionRole', 'staffRole'])] })).toEqual([]);
    expect(await run(id, { SetupState: [state(null)] })).toEqual([]);
    expect(await run(id, { SetupState: [] })).toEqual([]);
  });

  test('fail: unknown system ids, one finding each', async () => {
    const findings = await run(id, { SetupState: [state(['ticket', 'insights', 'xp'])] });
    expect(codes(findings)).toEqual(['core.setup_state.unknown_system', 'core.setup_state.unknown_system']);
    expect(findings.map(f => f.params.systemId)).toEqual(['insights', 'xp']);
    expect(findings[0]).toMatchObject({ rowId: 9, field: 'selectedSystems', repair: 'auto' });
  });

  test('pass: a non-array value written by the API does not crash the check', async () => {
    expect(await run(id, { SetupState: [state('ticket')] })).toEqual([]);
  });
});

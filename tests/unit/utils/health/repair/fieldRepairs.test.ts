/**
 * Field-level repairs end to end, one case per code: the real check flags rows
 * held in a fake database, the planner plans the fix, the applier writes it
 * through the real store, and the same check, run on the rows the database
 * holds afterwards, no longer reports it.
 */
import { describe, expect, test } from 'bun:test';
import { ApplicationCommand, PermissionFlagsBits } from 'discord.js';
import { DEFAULT_ANNOUNCEMENT_TEMPLATES } from '../../../../../src/utils/announcement/defaultTemplates';
import { createCommandSyncCheck } from '../../../../../src/utils/health/checks/commands';
import type { HealthEntityName } from '../../../../../src/utils/health/context';
import { getChecks } from '../../../../../src/utils/health/registry';
import { type ApplyDeps, applyRepairPlan, type RepairActor } from '../../../../../src/utils/health/repair/applier';
import { FIELD_REPAIRS } from '../../../../../src/utils/health/repair/fieldRepairs';
import { findingKey } from '../../../../../src/utils/health/repair/keys';
import { planRepairs } from '../../../../../src/utils/health/repair/planner';
import type { RepairStore } from '../../../../../src/utils/health/repair/store';
import type {
  PlanOptions,
  RepairEntityName,
  RepairOp,
  RepairProof,
} from '../../../../../src/utils/health/repair/types';
import { runHealthCheckWithContext } from '../../../../../src/utils/health/runner';
import type { HealthCheck, HealthReport } from '../../../../../src/utils/health/types';
import { FAKE_BOT_ID, makeFakeGuild } from '../../../../helpers/fakeGuild';
import { makeRepairDb } from '../../../../helpers/repairDb';
import { G, GONE_ROLE, guildInit, NEWS, ROLE, ROLE_2, TEXT } from '../communityFixtures';

type Row = Record<string, any>;
type Tables = Partial<Record<RepairEntityName, Row[]>>;

const COMMAND_CODES = ['core.commands.missing', 'core.commands.outdated', 'core.commands.unexpected'];
const ACTOR: RepairActor = { userId: '900000000000000001', source: 'command', checkedAt: '2026-10-07T12:00:00.000Z' };
const noop = () => {};

function depsFor(store: RepairStore, overrides: Partial<ApplyDeps> = {}): Partial<ApplyDeps> {
  return {
    store,
    invalidateGuildCaches: noop,
    invalidateBaitCaches: noop,
    requestGuildCommandRefresh: noop,
    registerGuildCommands: async () => {},
    writeAuditLog: async () => {},
    ...overrides,
  };
}

const findingsOf = (report: HealthReport) => Object.values(report.systems).flatMap(system => system?.findings ?? []);

/** The registered check that emits `code`. */
function checkFor(code: string): HealthCheck {
  const check = getChecks().find(c => c.codes.includes(code));
  if (!check) throw new Error(`no check emits ${code}`);
  return check;
}

/** A fake database holding `tables` (every row in guild G), and a check run that reads it like the loader does. */
function setup(tables: Tables) {
  const inGuild = Object.fromEntries(
    Object.entries(tables).map(([entity, rows]) => [entity, (rows ?? []).map(row => ({ guildId: G, ...row }))]),
  );
  const fake = makeRepairDb(inGuild);
  const guild = makeFakeGuild(guildInit({ botPermissions: [PermissionFlagsBits.Administrator] }));
  // Copies, as from a database read; a menu comes with its options (an eager relation).
  const loadRows = async (entity: HealthEntityName) => {
    const rows = [...fake.repo(entity).rows.values()];
    if (entity !== 'ReactionRoleMenu') return structuredClone(rows);
    const options = [...fake.repo('ReactionRoleOption').rows.values()];
    return structuredClone(rows.map(menu => ({ ...menu, options: options.filter(o => o.menuId === menu.id) })));
  };
  const run = (checks: readonly HealthCheck[]) => runHealthCheckWithContext(guild, {}, { checks, loadRows });
  const rows = (entity: RepairEntityName) => [...fake.repo(entity).rows.values()];
  return { ...fake, guild, run, rows };
}

/** Plans every finding of `code` (narrowed by `opts`), applies the plan, and runs the check again. */
async function roundTrip(code: string, tables: Tables, opts: PlanOptions = {}) {
  const db = setup(tables);
  const checks = [checkFor(code)];
  const { report, ctx } = await db.run(checks);
  const flagged = findingsOf(report).filter(f => f.code === code);
  const plan = planRepairs(report, ctx, { keys: flagged.map(findingKey), ...opts });
  const result = await applyRepairPlan(db.guild, plan, ACTOR, depsFor(db.store));
  const after = findingsOf((await db.run(checks)).report).filter(f => f.code === code);
  return { ...db, flagged, plan, result, after };
}

// Rows with every column their check reads.
const type = (id: number, o: Row = {}) => ({
  id,
  typeId: `type_${id}`,
  displayName: `Type ${id}`,
  emoji: null,
  embedColor: '#0099ff',
  isActive: true,
  isDefault: false,
  sortOrder: id,
  customFields: null,
  ...o,
});
const xp = (o: Row = {}) => ({
  id: 5,
  enabled: true,
  levelUpChannelId: null,
  ignoredChannels: [],
  ignoredRoles: [],
  multiplierChannels: null,
  xpPerMessageMin: 15,
  xpPerMessageMax: 25,
  ...o,
});
const staff = (id: number, role: string, alias = 'Mods', type = 'staff') => ({ id, type, role, alias });
const grant = (feature: string, level: string, roleId: string) => ({ id: 1, feature, level, roleId });
const failedTicket = () => ({
  id: 7,
  channelId: null,
  status: 'created',
  statusHistory: null,
  lastActivityAt: new Date(Date.now() - 20 * 60 * 1000),
});
const announcementConfig = { id: 1, defaultChannelId: TEXT, defaultRoleId: null };

interface Case {
  code: string;
  /** Test name, when one code has several cases. */
  name?: string;
  tables: Tables;
  repair: 'auto' | 'confirm';
  op: RepairOp;
  /** Every row each listed table holds afterwards, matched loosely. */
  after: Tables;
  /** What the applier re-proves first. Only a deleted Discord object needs it. */
  proof?: RepairProof;
}

const CASES: Case[] = [
  {
    code: 'core.global_staff_role.enabled_without_role',
    tables: { BotConfig: [{ globalStaffRole: null, enableGlobalStaffRole: true, locale: 'en' }] },
    repair: 'auto',
    op: 'set',
    after: { BotConfig: [{ globalStaffRole: null, enableGlobalStaffRole: false }] },
  },
  {
    code: 'core.global_staff_role.format_legacy',
    tables: { BotConfig: [{ globalStaffRole: `<@&${ROLE}>`, enableGlobalStaffRole: true, locale: 'en' }] },
    repair: 'auto',
    op: 'set',
    after: { BotConfig: [{ globalStaffRole: ROLE, enableGlobalStaffRole: true }] },
  },
  {
    code: 'core.locale.unsupported',
    tables: { BotConfig: [{ globalStaffRole: null, enableGlobalStaffRole: false, locale: 'jp' }] },
    repair: 'auto',
    op: 'set',
    after: { BotConfig: [{ locale: 'en' }] },
  },
  {
    code: 'core.staff_role.duplicate',
    name: 'core.staff_role.duplicate (same alias: the newer row goes, automatically)',
    tables: { StaffRole: [staff(1, ROLE), staff(2, `<@&${ROLE}>`)] },
    repair: 'auto',
    op: 'delete',
    after: { StaffRole: [{ id: 1 }] },
  },
  {
    code: 'core.staff_role.duplicate',
    name: 'core.staff_role.duplicate (another alias: the newer row goes, once confirmed)',
    tables: { StaffRole: [staff(1, ROLE), staff(2, `<@&${ROLE}>`, 'Helpers')] },
    repair: 'confirm',
    op: 'delete',
    after: { StaffRole: [{ id: 1 }] },
  },
  {
    code: 'core.staff_role.invalid',
    tables: { StaffRole: [staff(1, 'everyone', 'Old'), staff(2, ROLE)] },
    repair: 'confirm',
    op: 'delete',
    after: { StaffRole: [{ id: 2 }] },
  },
  {
    code: 'core.staff_role.format_legacy',
    tables: { StaffRole: [staff(1, `<@&${ROLE}>`, 'Admins', 'admin')] },
    repair: 'auto',
    op: 'set',
    after: { StaffRole: [{ id: 1, role: ROLE, alias: 'Admins' }] },
  },
  {
    code: 'core.guild_permission.unknown_feature',
    tables: { GuildPermission: [grant('nope', 'use', ROLE)] },
    repair: 'auto',
    op: 'delete',
    after: { GuildPermission: [] },
  },
  {
    code: 'core.guild_permission.unknown_level',
    tables: { GuildPermission: [grant('tickets', 'owner', ROLE)] },
    repair: 'auto',
    op: 'delete',
    after: { GuildPermission: [] },
  },
  {
    code: 'core.guild_permission.missing_role',
    tables: { GuildPermission: [grant('tickets', 'use', GONE_ROLE)] },
    repair: 'auto',
    op: 'delete',
    after: { GuildPermission: [] },
    proof: { kind: 'role', id: GONE_ROLE },
  },
  {
    // Two unknown systems on one row: one write, each fix applied in turn.
    code: 'core.setup_state.unknown_system',
    tables: { SetupState: [{ id: 1, selectedSystems: ['ticket', 'bogus', 'memory', 'legacy'] }] },
    repair: 'auto',
    op: 'set',
    after: { SetupState: [{ selectedSystems: ['ticket', 'memory'] }] },
  },
  {
    code: 'ticket.type.multiple_defaults',
    tables: { CustomTicketType: [type(1, { isDefault: true }), type(2, { isDefault: true })] },
    repair: 'auto',
    op: 'set',
    after: {
      CustomTicketType: [
        { id: 1, isDefault: true },
        { id: 2, isDefault: false },
      ],
    },
  },
  {
    code: 'ticket.type.color_invalid',
    tables: { CustomTicketType: [type(1, { embedColor: 'blue' })] },
    repair: 'auto',
    op: 'set',
    after: { CustomTicketType: [{ embedColor: '#0099ff' }] },
  },
  {
    code: 'ticket.type.emoji_invalid',
    tables: { CustomTicketType: [type(1, { emoji: 'ticket' })] },
    repair: 'confirm',
    op: 'set',
    after: { CustomTicketType: [{ emoji: null }] },
  },
  {
    code: 'ticket.restriction.unknown_type',
    tables: {
      CustomTicketType: [type(1)],
      UserTicketRestriction: [
        { id: 1, userId: '900000000000000002', typeId: 'ghost' },
        { id: 2, userId: '900000000000000002', typeId: 'type_1' },
      ],
    },
    repair: 'confirm',
    op: 'delete',
    after: { UserTicketRestriction: [{ id: 2 }] },
  },
  {
    code: 'ticket.open.creation_failed',
    tables: { Ticket: [failedTicket()] },
    repair: 'confirm',
    op: 'set',
    after: {
      Ticket: [
        {
          status: 'closed',
          channelId: null,
          statusHistory: [
            { status: 'closed', changedBy: 'system', changedAt: expect.any(String), note: 'creation-failed' },
          ],
        },
      ],
    },
  },
  {
    code: 'application.position.emoji_invalid',
    tables: { Position: [{ id: 1, title: 'Moderator', emoji: 'mod', isActive: true, customFields: null }] },
    repair: 'confirm',
    op: 'set',
    after: { Position: [{ emoji: null }] },
  },
  {
    code: 'memory.tag.orphan',
    tables: {
      MemoryConfig: [],
      MemoryTag: [{ id: 20, memoryConfigId: 99, name: 'Bug', tagType: 'category', discordTagId: null }],
    },
    repair: 'auto',
    op: 'delete',
    after: { MemoryTag: [] },
  },
  {
    // Saved memory text has no other copy, so repair asks first though the check rates it auto.
    code: 'memory.item.orphan',
    tables: {
      MemoryConfig: [],
      MemoryItem: [{ id: 10, memoryConfigId: 99, threadId: '400000000000000001', title: 'Old' }],
    },
    repair: 'confirm',
    op: 'delete',
    after: { MemoryItem: [] },
  },
  {
    code: 'reactionRole.menu.mode',
    tables: {
      ReactionRoleMenu: [{ id: 4, name: 'Roles', channelId: TEXT, messageId: '500000000000000001', mode: 'weird' }],
      ReactionRoleOption: [{ id: 40, menuId: 4, roleId: ROLE, emoji: '👍', sortOrder: 0 }],
    },
    repair: 'auto',
    op: 'set',
    after: { ReactionRoleMenu: [{ id: 4, mode: 'normal' }], ReactionRoleOption: [{ id: 40 }] },
  },
  {
    code: 'announcement.template.default_missing',
    tables: { AnnouncementConfig: [announcementConfig], AnnouncementTemplate: [] },
    repair: 'auto',
    op: 'insert',
    after: { AnnouncementTemplate: DEFAULT_ANNOUNCEMENT_TEMPLATES.map(t => ({ ...t, guildId: G })) },
  },
  {
    code: 'xp.config.multiplier_invalid',
    tables: { XPConfig: [xp({ multiplierChannels: { [TEXT]: 0, [NEWS]: 2 } })] },
    repair: 'confirm',
    op: 'set',
    after: { XPConfig: [{ multiplierChannels: { [NEWS]: 2 } }] },
  },
  {
    code: 'xp.config.multiplier_invalid',
    name: 'xp.config.multiplier_invalid (the last entry: the map becomes null, as channelDelete leaves it)',
    tables: { XPConfig: [xp({ multiplierChannels: { [TEXT]: -1 } })] },
    repair: 'confirm',
    op: 'set',
    after: { XPConfig: [{ multiplierChannels: null }] },
  },
  {
    code: 'xp.config.rate_inverted',
    tables: { XPConfig: [xp({ xpPerMessageMin: 30, xpPerMessageMax: 10 })] },
    repair: 'confirm',
    op: 'set',
    after: { XPConfig: [{ xpPerMessageMin: 10, xpPerMessageMax: 30 }] },
  },
  {
    code: 'xp.role_reward.duplicate_level',
    tables: {
      XPConfig: [xp()],
      XPRoleReward: [
        { id: 6, level: 5, roleId: ROLE },
        { id: 7, level: 5, roleId: ROLE_2 },
      ],
    },
    repair: 'confirm',
    op: 'delete',
    after: { XPRoleReward: [{ id: 6, roleId: ROLE }] },
  },
  {
    code: 'starboard.config.threshold_invalid',
    tables: {
      StarboardConfig: [{ id: 8, enabled: true, channelId: TEXT, emoji: '⭐', threshold: 0, ignoredChannels: [] }],
    },
    repair: 'confirm',
    op: 'set',
    after: { StarboardConfig: [{ threshold: 1 }] },
  },
];

describe('field repairs: plan, apply, check again', () => {
  for (const c of CASES) {
    test(c.name ?? c.code, async () => {
      const { flagged, plan, result, after, rows } = await roundTrip(c.code, c.tables);
      expect(flagged.length).toBeGreaterThan(0);
      expect(plan.unsupported).toEqual([]);
      expect(plan.fixes.map(fix => [fix.code, fix.repair, fix.op])).toEqual(
        flagged.map(() => [c.code, c.repair, c.op]),
      );
      expect(plan.steps.flatMap(step => step.proofs)).toEqual(c.proof ? [c.proof] : []);
      expect(result.results.map(r => r.outcome)).toEqual(plan.steps.map(() => 'applied'));
      expect(after).toEqual([]);
      for (const [entity, expected] of Object.entries(c.after)) {
        expect(rows(entity as RepairEntityName)).toMatchObject(expected ?? []);
      }
    });
  }

  test('every field repair has a case', () => {
    const covered = new Set([...CASES.map(c => c.code), ...COMMAND_CODES]);
    expect(Object.keys(FIELD_REPAIRS).filter(code => !covered.has(code))).toEqual([]);
  });
});

describe('field repairs: what each write is conditional on', () => {
  test('a repair the applier must re-prove is not planned for a finding without the object id', async () => {
    const db = setup({ GuildPermission: [grant('tickets', 'use', GONE_ROLE)] });
    const { report, ctx } = await db.run([checkFor('core.guild_permission.missing_role')]);
    const [finding] = findingsOf(report);
    delete finding.refId;
    const plan = planRepairs(report, ctx);
    expect(plan.unsupported).toEqual([
      { key: findingKey(finding), code: 'core.guild_permission.missing_role', reason: 'no_action' },
    ]);
    expect(plan.steps).toEqual([]);
  });

  test('a staff role saved twice is only removed automatically when both copies carry the same alias', async () => {
    for (const [alias, auto] of [
      ['Mods', ['core.staff_role.duplicate']],
      ['Helpers', []],
    ] as const) {
      const db = setup({ StaffRole: [staff(1, ROLE), staff(2, `<@&${ROLE}>`, alias)] });
      const { report, ctx } = await db.run([checkFor('core.staff_role.duplicate')]);
      expect(planRepairs(report, ctx, { classes: ['auto'] }).fixes.map(fix => fix.code)).toEqual([...auto]);
      // The guard holds the alias too, so a rename meanwhile leaves both rows.
      const plan = planRepairs(report, ctx);
      expect(plan.steps).toMatchObject([
        { entity: 'StaffRole', op: 'delete', guard: { type: 'staff', role: `<@&${ROLE}>`, alias } },
      ]);
      db.repo('StaffRole').rows.get('2').alias = 'Renamed';
      const result = await applyRepairPlan(db.guild, plan, ACTOR, depsFor(db.store));
      expect(result.results.map(r => r.outcome)).toEqual(['stale']);
      expect(db.ids('StaffRole')).toEqual([1, 2]);
    }
  });

  test("each unknown system's fix drops only its own id", async () => {
    const db = setup({ SetupState: [{ id: 1, selectedSystems: ['ticket', 'bogus', 'legacy'] }] });
    const { report, ctx } = await db.run([checkFor('core.setup_state.unknown_system')]);
    const plan = planRepairs(report, ctx);
    expect(plan.fixes.map(fix => fix.changes)).toEqual([
      [{ field: 'selectedSystems', before: ['ticket', 'bogus', 'legacy'], after: ['ticket', 'legacy'] }],
      [{ field: 'selectedSystems', before: ['ticket', 'bogus', 'legacy'], after: ['ticket', 'bogus'] }],
    ]);
    const [, legacy] = plan.fixes;
    const only = planRepairs(report, ctx, { keys: [legacy.key] });
    expect(only.steps).toMatchObject([{ set: { selectedSystems: ['ticket', 'bogus'] } }]);
  });

  test('a level whose oldest reward lost its role keeps the live reward when every fix is applied', async () => {
    const db = setup({
      XPConfig: [xp()],
      XPRoleReward: [
        { id: 6, level: 5, roleId: GONE_ROLE },
        { id: 7, level: 5, roleId: ROLE },
      ],
    });
    const checks = [checkFor('xp.role_reward.duplicate_level')];
    const { report, ctx } = await db.run(checks);
    const plan = planRepairs(report, ctx);
    expect(plan.fixes.map(fix => [fix.code, fix.rowId])).toEqual([['xp.role_reward.role_missing', 6]]);
    const result = await applyRepairPlan(db.guild, plan, ACTOR, depsFor(db.store));
    expect(result.results.map(r => r.outcome)).toEqual(['applied']);
    expect(db.rows('XPRoleReward')).toMatchObject([{ id: 7, level: 5, roleId: ROLE }]);
    expect(findingsOf((await db.run(checks)).report)).toEqual([]);
  });

  test('a ticket that got its channel meanwhile stays open', async () => {
    const db = setup({ Ticket: [failedTicket()] });
    const { report, ctx } = await db.run([checkFor('ticket.open.creation_failed')]);
    const plan = planRepairs(report, ctx);
    expect(plan.steps[0].guard).toEqual({ status: 'created', statusHistory: null, channelId: null });
    db.repo('Ticket').rows.get('7').channelId = TEXT;
    const result = await applyRepairPlan(db.guild, plan, ACTOR, depsFor(db.store));
    expect(result.results.map(r => r.outcome)).toEqual(['stale']);
    expect(db.rows('Ticket')).toMatchObject([{ status: 'created', channelId: TEXT, statusHistory: null }]);
  });

  test('the global staff role stays on when a role was picked meanwhile', async () => {
    const db = setup({ BotConfig: [{ globalStaffRole: null, enableGlobalStaffRole: true, locale: 'en' }] });
    const { report, ctx } = await db.run([checkFor('core.global_staff_role.enabled_without_role')]);
    const plan = planRepairs(report, ctx);
    expect(plan.steps[0]).toMatchObject({
      where: { guildId: G },
      set: { enableGlobalStaffRole: false },
      guard: { enableGlobalStaffRole: true, globalStaffRole: null },
    });
    db.repo('BotConfig').rows.get(G).globalStaffRole = ROLE;
    const result = await applyRepairPlan(db.guild, plan, ACTOR, depsFor(db.store));
    expect(result.results.map(r => r.outcome)).toEqual(['stale']);
    expect(db.rows('BotConfig')).toMatchObject([{ enableGlobalStaffRole: true, globalStaffRole: ROLE }]);
  });

  test('a template added meanwhile makes the insert exists, and the added row is kept', async () => {
    const [missing, ...present] = DEFAULT_ANNOUNCEMENT_TEMPLATES;
    const db = setup({
      AnnouncementConfig: [announcementConfig],
      AnnouncementTemplate: present.map((template, i) => ({ id: i + 1, ...template })),
    });
    const { report, ctx } = await db.run([checkFor('announcement.template.default_missing')]);
    const plan = planRepairs(report, ctx);
    expect(plan.steps).toMatchObject([
      { entity: 'AnnouncementTemplate', op: 'insert', where: { guildId: G }, guard: {}, proofs: [] },
    ]);
    expect(plan.steps[0].values).toEqual({ ...missing, guildId: G });

    // Like the table's unique (guildId, name) key.
    const templates = db.repo('AnnouncementTemplate');
    const insert = templates.insert;
    templates.insert = async (values: Row) => {
      if (db.rows('AnnouncementTemplate').some(row => row.guildId === values.guildId && row.name === values.name)) {
        throw Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
      }
      return insert(values);
    };
    const theirs = { id: 99, guildId: G, ...missing, displayName: 'Our maintenance' };
    templates.rows.set('99', theirs);
    const result = await applyRepairPlan(db.guild, plan, ACTOR, depsFor(db.store));
    expect(result.results.map(r => r.outcome)).toEqual(['exists']);
    expect(db.rows('AnnouncementTemplate')).toHaveLength(DEFAULT_ANNOUNCEMENT_TEMPLATES.length);
    expect(templates.rows.get('99')).toEqual(theirs);
  });
});

describe('core.commands: one registration for all three findings', () => {
  type Json = { name: string; description: string; type: number };
  const expected: Json[] = [
    { name: 'alpha', description: 'Alpha', type: 1 },
    { name: 'beta', description: 'Beta', type: 1 },
  ];

  /** A guild whose `commands.fetch` returns `registered`, as discord.js wraps what Discord sends. */
  function commandGuild(registered: { current: Json[] }) {
    const guild = makeFakeGuild(guildInit());
    const wrap = (json: Json, i: number) =>
      new (ApplicationCommand as any)(
        {},
        { ...json, id: String(600000000000000000n + BigInt(i)), application_id: FAKE_BOT_ID, version: '1' },
        guild,
      ) as ApplicationCommand;
    (guild as any).commands = {
      fetch: async () => new Map(registered.current.map((json, i) => [String(i), wrap(json, i)])),
    };
    return guild;
  }

  test('missing, outdated and unexpected commands are one step, and registering clears all three', async () => {
    const registered = {
      current: [
        { ...expected[1], description: 'Old beta' },
        { name: 'gamma', description: 'Gone', type: 1 },
      ],
    };
    const guild = commandGuild(registered);
    const checks = [createCommandSyncCheck(async () => expected)];
    const run = () => runHealthCheckWithContext(guild, {}, { checks });
    const { report, ctx } = await run();
    const flagged = findingsOf(report);
    expect(flagged.map(f => [f.code, f.repair])).toEqual(COMMAND_CODES.map(code => [code, 'auto']));

    const plan = planRepairs(report, ctx);
    expect(plan.fixes.map(fix => [fix.code, fix.op, fix.entity])).toEqual(
      COMMAND_CODES.map(code => [code, 'command', 'ApplicationCommand']),
    );
    expect(plan.steps).toEqual([
      {
        entity: 'ApplicationCommand',
        where: { guildId: G },
        op: 'command',
        command: 'registerGuildCommands',
        guard: {},
        proofs: [],
        keys: flagged.map(findingKey),
      },
    ]);
    // One selected finding still registers the whole set, in one step of its own.
    const one = planRepairs(report, ctx, { keys: [findingKey(flagged[1])] });
    expect(one.steps.map(step => [step.op, step.keys])).toEqual([['command', [findingKey(flagged[1])]]]);

    const calls: string[] = [];
    const registerGuildCommands = async (guildId: string) => {
      calls.push(guildId);
      registered.current = expected;
    };
    const { store } = makeRepairDb({});
    const result = await applyRepairPlan(guild, plan, ACTOR, depsFor(store, { registerGuildCommands }));
    expect(result.results.map(r => r.outcome)).toEqual(['applied']);
    expect(calls).toEqual([G]);
    expect(findingsOf((await run()).report)).toEqual([]);
  });
});

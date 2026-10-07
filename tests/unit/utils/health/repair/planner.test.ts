/**
 * Repair planner. Findings come from the real checks on a fake guild (deep
 * mode, where uncached threads and unknown messages read as deleted), so each
 * case also pins the check's code and class. Merge rules that no single check
 * run produces use hand-built reports.
 */
import { describe, expect, test } from 'bun:test';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import type { LoadedRows } from '../../../../../src/utils/health/context';
import { getChecks } from '../../../../../src/utils/health/registry';
import { findingKey } from '../../../../../src/utils/health/repair/keys';
import { planRepairs } from '../../../../../src/utils/health/repair/planner';
import type { PlanOptions, RepairPlan, RepairProof } from '../../../../../src/utils/health/repair/types';
import { buildReport, runHealthCheckWithContext } from '../../../../../src/utils/health/runner';
import type { HealthFinding, HealthSystem, RepairClass } from '../../../../../src/utils/health/types';
import { type FakeChannelInit, makeFakeGuild } from '../../../../helpers/fakeGuild';
import { makeCheckContext } from '../../../../helpers/healthContext';
import { CATEGORY, G, GONE_CHANNEL as GONE, GONE_ROLE, guildInit, ROLE, TEXT } from '../communityFixtures';
import { withMessages, withThreadFetch } from '../moderationHelpers';

const GONE_2 = '300000000000000667';
const FORUM = '300000000000000010';
const THREAD = '400000000000000001';
const GONE_THREAD = '400000000000000666';
const MSG = '500000000000000001';
const GONE_MSG = '500000000000000666';

/** Every check but the command sync, which asks Discord for the registered commands. */
const CHECKS = getChecks().filter(check => check.id !== 'core.commands');

/** Runs the checks on rows (null = that entity failed to load) and plans from the same run. */
async function planFor(rows: LoadedRows, opts: PlanOptions = {}) {
  const forum = { id: FORUM, type: ChannelType.GuildForum, availableTags: [] } as FakeChannelInit;
  const init = guildInit({ botPermissions: [PermissionFlagsBits.Administrator] });
  const guild = makeFakeGuild({ ...init, channels: [...(init.channels ?? []), forum] });
  withThreadFetch(guild, [THREAD]);
  withMessages(guild, TEXT, [MSG]);
  const loadRows = async (entity: keyof LoadedRows) => {
    if (rows[entity] === null) throw new Error('load failed');
    return rows[entity] ?? [];
  };
  const { report, ctx } = await runHealthCheckWithContext(guild, { deep: true }, { checks: CHECKS, loadRows });
  const findings = Object.values(report.systems).flatMap(system => system?.findings ?? []);
  // A fixture missing a column a check reads would hide behind an <id>.error finding.
  expect(findings.filter(f => f.code.endsWith('.error')).map(f => f.code)).toEqual([]);
  return { report, ctx, findings, plan: planRepairs(report, ctx, opts) };
}

const fixFor = (plan: RepairPlan, code: string) => {
  const fix = plan.fixes.find(f => f.code === code);
  if (!fix) throw new Error(`no fix for ${code}: ${JSON.stringify(plan.unsupported)}`);
  return fix;
};
const stepFor = (plan: RepairPlan, key: string) => plan.steps.find(step => step.keys.includes(key));

// Rows with every column their check reads.
const ticketConfig = (o = {}) => ({ id: 1, channelId: TEXT, messageId: MSG, categoryId: CATEGORY, ...o });
const archive = (o = {}) => ({ id: 2, channelId: FORUM, messageId: '', ...o });
const openTicket = { id: 7, channelId: GONE, status: 'opened', statusHistory: null, lastActivityAt: new Date() };
const announcement = (o = {}) => ({ id: 1, defaultChannelId: TEXT, defaultRoleId: null, ...o });
const memoryConfig = (o = {}) => ({ id: 3, forumChannelId: FORUM, channelName: 'memory', messageId: null, ...o });
const item = (id: number, threadId: string) => ({ id, memoryConfigId: 3, threadId, title: `item ${id}` });
const tag = { id: 20, memoryConfigId: 3, name: 'Bug', tagType: 'category', discordTagId: null };
const option = (id: number, roleId: string) => ({ id, menuId: 4, roleId, emoji: id % 2 ? '👍' : '🎉', sortOrder: id });
const menu = (o = {}) => ({
  id: 4,
  name: 'Roles',
  channelId: TEXT,
  messageId: MSG,
  mode: 'normal',
  options: [option(40, ROLE)],
  ...o,
});
const xp = (o = {}) => ({
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
const starboard = (o = {}) => ({
  id: 8,
  enabled: true,
  channelId: TEXT,
  emoji: '⭐',
  threshold: 3,
  ignoredChannels: [],
  ...o,
});
const roleStep = (roleIds: string[]) => ({
  id: 'pick',
  type: 'role-select',
  title: 'Pick',
  description: '',
  required: false,
  options: roleIds.map(roleId => ({ roleId, label: roleId })),
});
const onboarding = (o = {}) => ({
  id: 9,
  enabled: true,
  completionRoleId: null,
  welcomeMessage: 'Welcome!',
  steps: [roleStep([ROLE])],
  ...o,
});
const rules = (o = {}) => ({ id: 11, channelId: TEXT, messageId: MSG, roleId: ROLE, emoji: '✅', ...o });

const closed = (before: unknown) => [
  before,
  [{ status: 'closed', changedBy: 'system', changedAt: expect.any(String), note: 'channel-deleted' }],
];

interface Case {
  code: string;
  rows: LoadedRows;
  repair: 'auto' | 'confirm';
  /** A set: field → [before, after]. */
  changes?: Record<string, unknown[]>;
  /** A delete: its guard and cascade counts. */
  guard?: Record<string, unknown>;
  cascade?: Record<string, number>;
  proof: RepairProof;
}

const channel = (id: string): RepairProof => ({ kind: 'channel', id });
const role = (id: string): RepairProof => ({ kind: 'role', id });
const thread = (id: string): RepairProof => ({ kind: 'thread', id });

const CASES: Case[] = [
  {
    code: 'core.global_staff_role.missing',
    rows: { BotConfig: [{ guildId: G, globalStaffRole: GONE_ROLE, enableGlobalStaffRole: true, locale: 'en' }] },
    repair: 'auto',
    changes: { globalStaffRole: [GONE_ROLE, null], enableGlobalStaffRole: [true, false] },
    proof: role(GONE_ROLE),
  },
  {
    code: 'core.staff_role.missing',
    rows: { StaffRole: [{ id: 1, type: 'staff', role: `<@&${GONE_ROLE}>`, alias: 'Mods' }] },
    repair: 'auto',
    guard: { role: `<@&${GONE_ROLE}>` },
    proof: role(GONE_ROLE),
  },
  ...(['ticket', 'application'] as const).flatMap((system): Case[] => {
    const [config, archived] =
      system === 'ticket'
        ? ['TicketConfig', 'ArchivedTicketConfig']
        : ['ApplicationConfig', 'ArchivedApplicationConfig'];
    const row = system === 'ticket' ? openTicket : { ...openTicket, status: 'pending' };
    return [
      {
        code: `${system}.panel.channel_missing`,
        rows: { [config]: [ticketConfig({ channelId: GONE })] },
        repair: 'auto',
        changes: { channelId: [GONE, ''], messageId: [MSG, ''] },
        proof: channel(GONE),
      },
      {
        code: `${system}.panel.category_missing`,
        rows: { [config]: [ticketConfig({ categoryId: GONE })] },
        repair: 'auto',
        changes: { categoryId: [GONE, null] },
        proof: channel(GONE),
      },
      {
        code: `${system}.archive.channel_missing`,
        rows: { [archived]: [archive({ channelId: GONE, messageId: MSG })] },
        repair: 'auto',
        changes: { channelId: [GONE, ''], messageId: [MSG, ''] },
        proof: channel(GONE),
      },
      {
        code: `${system}.open.channel_missing`,
        rows: { [system === 'ticket' ? 'Ticket' : 'Application']: [row] },
        repair: 'confirm',
        changes: { status: [row.status, 'closed'], statusHistory: closed(null) },
        proof: channel(GONE),
      },
    ];
  }),
  {
    code: 'announcement.config.channel_missing',
    rows: { AnnouncementConfig: [announcement({ defaultChannelId: GONE_THREAD })] },
    repair: 'auto',
    changes: { defaultChannelId: [GONE_THREAD, ''] },
    proof: thread(GONE_THREAD),
  },
  {
    code: 'announcement.config.role_missing',
    rows: { AnnouncementConfig: [announcement({ defaultRoleId: GONE_ROLE })] },
    repair: 'auto',
    changes: { defaultRoleId: [GONE_ROLE, null] },
    proof: role(GONE_ROLE),
  },
  {
    code: 'memory.forum.missing',
    rows: {
      MemoryConfig: [memoryConfig({ forumChannelId: GONE })],
      MemoryItem: [item(10, THREAD), item(11, THREAD), { ...item(12, THREAD), memoryConfigId: 99 }],
      MemoryTag: [tag],
    },
    // The check rates it auto; repair asks first because the saved memories go with it.
    repair: 'confirm',
    guard: { forumChannelId: GONE },
    cascade: { MemoryItem: 2, MemoryTag: 1 },
    proof: channel(GONE),
  },
  {
    code: 'memory.forum.welcome_missing',
    rows: { MemoryConfig: [memoryConfig({ messageId: GONE_THREAD })] },
    repair: 'confirm',
    changes: { messageId: [GONE_THREAD, null] },
    proof: thread(GONE_THREAD),
  },
  {
    code: 'memory.item.thread_missing',
    rows: { MemoryConfig: [memoryConfig()], MemoryItem: [item(10, GONE_THREAD), item(11, THREAD)] },
    repair: 'confirm',
    guard: { threadId: GONE_THREAD },
    proof: thread(GONE_THREAD),
  },
  {
    code: 'reactionRole.option.role_missing',
    rows: { ReactionRoleMenu: [menu({ options: [option(40, ROLE), option(41, GONE_ROLE)] })] },
    repair: 'auto',
    guard: { roleId: GONE_ROLE },
    proof: role(GONE_ROLE),
  },
  {
    code: 'reactionRole.menu.channel_missing',
    rows: { ReactionRoleMenu: [menu({ channelId: GONE, options: [option(40, ROLE), option(41, ROLE)] })] },
    repair: 'confirm',
    guard: { channelId: GONE },
    cascade: { ReactionRoleOption: 2 },
    proof: channel(GONE),
  },
  {
    code: 'reactionRole.menu.message_missing',
    rows: { ReactionRoleMenu: [menu({ messageId: GONE_MSG })] },
    repair: 'confirm',
    guard: { messageId: GONE_MSG },
    cascade: { ReactionRoleOption: 1 },
    proof: { kind: 'message', id: GONE_MSG, channelId: TEXT },
  },
  {
    code: 'xp.config.level_up_channel_missing',
    rows: { XPConfig: [xp({ levelUpChannelId: GONE })] },
    repair: 'auto',
    changes: { levelUpChannelId: [GONE, null] },
    proof: channel(GONE),
  },
  {
    code: 'xp.config.ignored_channel_missing',
    rows: { XPConfig: [xp({ ignoredChannels: [TEXT, GONE] })] },
    repair: 'auto',
    changes: { ignoredChannels: [[TEXT, GONE], [TEXT]] },
    proof: channel(GONE),
  },
  {
    code: 'xp.config.ignored_role_missing',
    rows: { XPConfig: [xp({ ignoredRoles: [GONE_ROLE, ROLE] })] },
    repair: 'auto',
    changes: { ignoredRoles: [[GONE_ROLE, ROLE], [ROLE]] },
    proof: role(GONE_ROLE),
  },
  {
    code: 'xp.config.multiplier_channel_missing',
    rows: { XPConfig: [xp({ multiplierChannels: { [GONE]: 2, [TEXT]: 1.5 } })] },
    repair: 'auto',
    changes: { multiplierChannels: [{ [GONE]: 2, [TEXT]: 1.5 }, { [TEXT]: 1.5 }] },
    proof: channel(GONE),
  },
  {
    code: 'xp.role_reward.role_missing',
    rows: { XPConfig: [xp()], XPRoleReward: [{ id: 6, level: 5, roleId: GONE_ROLE }] },
    repair: 'auto',
    guard: { roleId: GONE_ROLE },
    proof: role(GONE_ROLE),
  },
  {
    code: 'starboard.config.channel_missing',
    rows: { StarboardConfig: [starboard({ channelId: GONE })] },
    repair: 'auto',
    changes: { enabled: [true, false], channelId: [GONE, ''] },
    proof: channel(GONE),
  },
  {
    code: 'starboard.config.ignored_channel_missing',
    rows: { StarboardConfig: [starboard({ ignoredChannels: [GONE] })] },
    repair: 'auto',
    changes: { ignoredChannels: [[GONE], []] },
    proof: channel(GONE),
  },
  {
    code: 'onboarding.config.completion_role_missing',
    rows: { OnboardingConfig: [onboarding({ completionRoleId: GONE_ROLE })] },
    repair: 'auto',
    changes: { completionRoleId: [GONE_ROLE, null] },
    proof: role(GONE_ROLE),
  },
  {
    code: 'onboarding.config.step_role_missing',
    rows: { OnboardingConfig: [onboarding({ steps: [roleStep([GONE_ROLE, ROLE])] })] },
    repair: 'auto',
    changes: { steps: [[roleStep([GONE_ROLE, ROLE])], [roleStep([ROLE])]] },
    proof: role(GONE_ROLE),
  },
  {
    code: 'rules.config.channel_missing',
    rows: { RulesConfig: [rules({ channelId: GONE })] },
    repair: 'confirm',
    guard: { channelId: GONE },
    proof: channel(GONE),
  },
  {
    code: 'rules.config.message_missing',
    rows: { RulesConfig: [rules({ messageId: GONE_MSG })] },
    repair: 'confirm',
    guard: { messageId: GONE_MSG },
    proof: { kind: 'message', id: GONE_MSG, channelId: TEXT },
  },
];

const column = (changes: Record<string, unknown[]>, i: 0 | 1) =>
  Object.fromEntries(Object.entries(changes).map(([field, pair]) => [field, pair[i]]));

describe('planRepairs: one case per repairable code', () => {
  for (const c of CASES) {
    test(c.code, async () => {
      const { plan } = await planFor(c.rows);
      const fix = fixFor(plan, c.code);
      const step = stepFor(plan, fix.key);
      expect(fix.repair).toBe(c.repair);
      expect(step?.proofs).toEqual([c.proof]);
      if (c.changes) {
        expect(fix.op).toBe('set');
        expect(Object.fromEntries(fix.changes.map(ch => [ch.field, [ch.before, ch.after]]))).toEqual(c.changes);
        expect(step).toMatchObject({ op: 'set', set: column(c.changes, 1), guard: column(c.changes, 0) });
      } else {
        expect(fix).toMatchObject({ op: 'delete', changes: [] });
        expect(fix.cascade).toEqual(c.cascade);
        expect(step).toMatchObject({ op: 'delete', guard: c.guard });
        expect(step?.set).toBeUndefined();
      }
    });
  }

  test('steps are scoped to the guild: BotConfig by its key, options through their menu', async () => {
    const { plan } = await planFor({
      BotConfig: [{ guildId: G, globalStaffRole: GONE_ROLE, enableGlobalStaffRole: false, locale: 'en' }],
      ReactionRoleMenu: [menu({ options: [option(41, GONE_ROLE)] })],
      RulesConfig: [rules({ channelId: GONE })],
    });
    expect(plan.steps.map(step => [step.entity, step.where])).toEqual([
      ['BotConfig', { guildId: G }],
      ['RulesConfig', { guildId: G, id: 11 }],
      ['ReactionRoleOption', { guildId: G, id: 41, menuId: 4 }],
    ]);
    // Already off: only the column that changes is written and guarded.
    expect(plan.steps[0]).toMatchObject({ set: { globalStaffRole: null }, guard: { globalStaffRole: GONE_ROLE } });
  });
});

describe('planRepairs: merging', () => {
  test('fixes on one XP row become one step, each fix showing its own diff', async () => {
    const row = xp({ levelUpChannelId: GONE, ignoredChannels: [GONE, GONE_2, TEXT], ignoredRoles: [GONE_ROLE] });
    const { plan } = await planFor({ XPConfig: [row] });
    expect(plan.fixes.map(f => f.code)).toEqual([
      'xp.config.level_up_channel_missing',
      'xp.config.ignored_channel_missing',
      'xp.config.ignored_channel_missing',
      'xp.config.ignored_role_missing',
    ]);
    // Against the row as loaded, so one selected alone shows the same diff.
    expect(plan.fixes[2].changes).toEqual([
      { field: 'ignoredChannels', before: [GONE, GONE_2, TEXT], after: [GONE, TEXT] },
    ]);
    expect(plan.steps).toEqual([
      {
        entity: 'XPConfig',
        where: { guildId: G, id: 5 },
        op: 'set',
        set: { levelUpChannelId: null, ignoredChannels: [TEXT], ignoredRoles: [] },
        guard: { levelUpChannelId: GONE, ignoredChannels: [GONE, GONE_2, TEXT], ignoredRoles: [GONE_ROLE] },
        proofs: [channel(GONE), channel(GONE_2), role(GONE_ROLE)],
        keys: plan.fixes.map(f => f.key),
      },
    ]);
  });

  test('a menu delete absorbs the delete of its own option', async () => {
    const rows = { ReactionRoleMenu: [menu({ channelId: GONE, options: [option(40, ROLE), option(41, GONE_ROLE)] })] };
    const { plan } = await planFor(rows);
    const menuFix = fixFor(plan, 'reactionRole.menu.channel_missing');
    const optionFix = fixFor(plan, 'reactionRole.option.role_missing');
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({
      entity: 'ReactionRoleMenu',
      op: 'delete',
      cascade: [{ entity: 'ReactionRoleOption', column: 'menuId' }],
      keys: [menuFix.key, optionFix.key],
      proofs: [channel(GONE)],
    });
    // Without the menu (auto only), the option is its own step.
    const autoOnly = (await planFor(rows, { classes: ['auto'] })).plan;
    expect(autoOnly.fixes.map(f => f.code)).toEqual(['reactionRole.option.role_missing']);
    expect(autoOnly.steps.map(step => step.entity)).toEqual(['ReactionRoleOption']);
  });

  const finding = (code: string, entity: string, rowId: number, refId: string, repair: RepairClass = 'auto') =>
    ({
      code,
      system: code.split('.')[0],
      severity: 'cosmetic',
      repair,
      entity,
      rowId,
      refId,
      params: {},
    }) as HealthFinding;
  const reportOf = (findings: HealthFinding[]) =>
    buildReport(
      findings.map(f => ({ checkId: f.code, system: f.system as HealthSystem, configured: true, findings: [f] })),
      { guildId: G, botVersion: 'test', checkedAt: '', deep: false, notChecked: [] },
    );

  test('a delete absorbs sets on the same row, and a memory forum delete absorbs its items', () => {
    const rows = {
      MemoryConfig: [memoryConfig({ forumChannelId: GONE, messageId: GONE_THREAD })],
      MemoryItem: [item(10, GONE_THREAD), { ...item(11, GONE_THREAD), memoryConfigId: 99 }],
      MemoryTag: [],
    };
    const findings = [
      finding('memory.forum.welcome_missing', 'MemoryConfig', 3, GONE_THREAD, 'confirm'),
      finding('memory.forum.missing', 'MemoryConfig', 3, GONE),
      finding('memory.item.thread_missing', 'MemoryItem', 10, GONE_THREAD),
      finding('memory.item.thread_missing', 'MemoryItem', 11, GONE_THREAD),
    ];
    const plan = planRepairs(reportOf(findings), makeCheckContext({ rows }));
    const [welcome, forum, absorbed, other] = findings.map(findingKey);
    expect(plan.fixes.map(f => [f.op, f.repair])).toEqual([
      ['set', 'confirm'],
      ['delete', 'confirm'],
      ['delete', 'confirm'],
      ['delete', 'confirm'],
    ]);
    expect(plan.steps).toEqual([
      {
        entity: 'MemoryConfig',
        where: { guildId: G, id: 3 },
        op: 'delete',
        guard: { forumChannelId: GONE },
        cascade: [
          { entity: 'MemoryItem', column: 'memoryConfigId' },
          { entity: 'MemoryTag', column: 'memoryConfigId' },
        ],
        proofs: [channel(GONE)],
        keys: [welcome, forum, absorbed],
      },
      {
        entity: 'MemoryItem',
        where: { guildId: G, id: 11 },
        op: 'delete',
        guard: { threadId: GONE_THREAD },
        proofs: [thread(GONE_THREAD)],
        keys: [other],
      },
    ]);
  });

  test('unsupported: no repair, rows not loaded, row gone, nothing to change', () => {
    const findings = [
      finding('core.locale.unsupported', 'BotConfig', 1, ''),
      finding('starboard.config.channel_missing', 'StarboardConfig', 8, GONE),
      finding('xp.config.ignored_channel_missing', 'XPConfig', 6, GONE),
      finding('xp.config.ignored_channel_missing', 'XPConfig', 5, GONE_2),
      // The preview must count the saved memories a forum delete takes, so unloaded items block it.
      finding('memory.forum.missing', 'MemoryConfig', 3, GONE),
    ];
    const rows = {
      StarboardConfig: null,
      XPConfig: [xp({ ignoredChannels: [GONE] })],
      MemoryConfig: [memoryConfig({ forumChannelId: GONE })],
      MemoryItem: null,
      MemoryTag: [],
    };
    const plan = planRepairs(reportOf(findings), makeCheckContext({ rows }));
    expect(plan.unsupported.map(u => [u.code, u.reason])).toEqual([
      ['core.locale.unsupported', 'no_action'],
      ['starboard.config.channel_missing', 'rows_unavailable'],
      ['xp.config.ignored_channel_missing', 'row_gone'],
      ['xp.config.ignored_channel_missing', 'no_change'],
      ['memory.forum.missing', 'rows_unavailable'],
    ]);
    expect(plan.unsupported.map(u => u.key)).toEqual(findings.map(findingKey));
    expect(plan).toMatchObject({ fixes: [], steps: [] });
  });
});

describe('planRepairs: selection and safety', () => {
  const rows = (): LoadedRows => ({
    XPConfig: [xp({ ignoredChannels: [GONE, TEXT], ignoredRoles: [GONE_ROLE], multiplierChannels: { [GONE_2]: 2 } })],
    MemoryConfig: [memoryConfig({ forumChannelId: GONE })],
    MemoryItem: [item(10, THREAD)],
    MemoryTag: [tag],
    ReactionRoleMenu: [menu({ options: [option(40, GONE_ROLE), option(41, ROLE)] })],
    OnboardingConfig: [onboarding({ steps: [roleStep([GONE_ROLE, ROLE])] })],
    Ticket: [{ ...openTicket }],
    RulesConfig: [rules({ roleId: GONE_ROLE })],
  });

  test('manual findings are neither fixed nor listed as unsupported', async () => {
    const { plan, findings } = await planFor(rows());
    const manual = findings.filter(f => f.repair === 'manual').map(findingKey);
    expect(manual.length).toBeGreaterThan(0); // rules.config.role_missing at least
    const listed = [...plan.fixes.map(f => f.key), ...plan.unsupported.map(u => u.key)];
    expect(listed.filter(key => manual.includes(key))).toEqual([]);
    expect(findings.find(f => f.code === 'rules.config.role_missing')?.repair).toBe('manual');
  });

  test('keys narrow the plan to the selected fixes', async () => {
    const { plan: all } = await planFor(rows());
    const picked = all.fixes.filter(f => f.code === 'xp.config.ignored_role_missing' || f.entity === 'Ticket');
    expect(picked).toHaveLength(2);
    const { plan } = await planFor(rows(), { keys: picked.map(f => f.key) });
    // Keys, not whole fixes: the ticket's new history entry carries the time of each run.
    expect(plan.fixes.map(f => f.key)).toEqual(picked.map(f => f.key));
    expect(plan.steps.map(step => [step.entity, step.op, step.keys.length])).toEqual([
      ['Ticket', 'set', 1],
      ['XPConfig', 'set', 1],
    ]);
    expect(plan.steps[1].set).toEqual({ ignoredRoles: [] });
  });

  test('classes filter after the memory override: auto leaves the forum delete out', async () => {
    const { plan: all, findings } = await planFor(rows());
    expect(findings.find(f => f.code === 'memory.forum.missing')?.repair).toBe('auto');
    expect(fixFor(all, 'memory.forum.missing').repair).toBe('confirm');
    const auto = (await planFor(rows(), { classes: ['auto'] })).plan;
    expect(auto.fixes.length).toBeGreaterThan(0);
    expect(auto.fixes.filter(f => f.repair !== 'auto')).toEqual([]);
    expect(auto.fixes.map(f => f.code)).not.toContain('memory.forum.missing');
    const confirm = (await planFor(rows(), { classes: ['confirm'] })).plan;
    expect(confirm.fixes.map(f => f.code).sort()).toEqual(['memory.forum.missing', 'ticket.open.channel_missing']);
  });

  test('planning never changes the loaded rows, and the plan shares no objects with them', async () => {
    const freeze = (value: unknown): unknown => {
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        for (const child of Object.values(value)) freeze(child);
        Object.freeze(value);
      }
      return value;
    };
    const loaded = rows();
    const before = structuredClone(loaded);
    freeze(loaded); // a write to a row (or anything in it) now throws
    const { plan, ctx } = await planFor(loaded);
    expect(plan.steps.length).toBeGreaterThan(3);
    const reloaded = () =>
      Object.fromEntries(Object.keys(before).map(entity => [entity, ctx.rows[entity as keyof LoadedRows]]));
    expect(reloaded()).toEqual(before);
    // Every array and object in the plan is a copy: changing them leaves the rows alone.
    const mutate = (value: unknown): void => {
      if (value && typeof value === 'object') for (const child of Object.values(value)) mutate(child);
      if (Array.isArray(value)) value.push('changed');
    };
    for (const step of plan.steps) mutate([step.set, step.guard]);
    for (const fix of plan.fixes) mutate(fix.changes);
    expect(reloaded()).toEqual(before);
  });
});

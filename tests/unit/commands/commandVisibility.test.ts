/**
 * Command visibility and guard coverage (hybrid model, v3.16.37).
 *
 * Meta and destructive commands keep the Administrator default permission, so
 * Discord hides them from everyone else. Every feature command is registered
 * with a null default (visible to all members), and its handlers decide who
 * may run it through the feature guards, so dashboard role grants work. That
 * is only safe if EVERY path a visible command routes to is guarded.
 *
 * This suite walks the real command registry (commandList) and:
 *   1. pins which commands stay hidden and requires every visible
 *      command/subcommand to have a row in GUARDS (a new subcommand without a
 *      row fails here);
 *   2. dispatches each guarded path through the real router as a non-admin
 *      member and checks the refusal names the expected feature and level:
 *        - unconfigured guild (no grants)      → Administrator fallback
 *        - configured guild, no matching role  → "no permission for <feature>"
 *        - granted one level too low           → "requires at least <level>"
 *   3. checks autocomplete answers nothing to members without a grant.
 *
 * Permission rows come from a fake GuildPermission repository installed by
 * patching AppDataSource.getRepository (restored in afterAll). Any other
 * entity throws at getRepository, so a handler's lazyRepo never caches a
 * repository from this suite (the real one would stick and break later
 * suites that patch getRepository). The /application check case needs
 * Application fakes: those are forwarding proxies that hand every later
 * access to whatever getRepository is installed at that time.
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { MessageFlags } from 'discord.js';
import { commands } from '../../../src/commands/commandList';
import { dispatchCommand } from '../../../src/commands/commands';
import { handleContextMenuCommand } from '../../../src/commands/handlers/contextMenus';
import { handleAutocomplete } from '../../../src/events/autocomplete';
import applicationLang from '../../../src/lang/en/application.json';
import { AppDataSource } from '../../../src/typeorm';
import { Application } from '../../../src/typeorm/entities/application/Application';
import { ApplicationConfig } from '../../../src/typeorm/entities/application/ApplicationConfig';
import { GuildPermission } from '../../../src/typeorm/entities/GuildPermission';
import { enhancedLogger } from '../../../src/utils/monitoring/enhancedLogger';
import type { Feature, Level } from '../../../src/utils/validation/featurePermission';

// ---------------------------------------------------------------------------
// Expected guards
// ---------------------------------------------------------------------------

type Guard = { feature: Feature; level: Level } | { admin: true } | { publicReason: string };

const use = (feature: Feature): Guard => ({ feature, level: 'use' });
const manage = (feature: Feature): Guard => ({ feature, level: 'manage' });
const admin = (feature: Feature): Guard => ({ feature, level: 'admin' });

/** Commands that keep a non-null default permission (hidden from members). */
const HIDDEN_COMMANDS = [
  'archive',
  'bot-reset',
  'bot-setup',
  'data-export',
  'dev',
  'import',
  'migrate',
  // Saved staff/admin roles: guardAdmin only, not in the FEATURES catalog, so
  // showing it to members would grant nothing.
  'role',
  'status',
];

/**
 * Every visible command path → the first guard a member hits. Keys are the
 * command name plus group and subcommand, space-separated; context menus use
 * their display name.
 */
const GUARDS: Record<string, Guard> = {
  // --- tickets ---
  'ticket-setup': manage('tickets'),
  'ticket type add': manage('tickets'),
  'ticket type edit': use('tickets'), // opens the type view; edits inside need manage
  'ticket type list': use('tickets'),
  'ticket type toggle': manage('tickets'),
  'ticket type default': manage('tickets'),
  'ticket type remove': manage('tickets'),
  'ticket type fields': manage('tickets'),
  'ticket manage status': manage('tickets'),
  'ticket manage assign': manage('tickets'),
  'ticket manage unassign': manage('tickets'),
  'ticket manage info': use('tickets'),
  'ticket manage import-email': manage('tickets'),
  'ticket manage user-restrict': manage('tickets'),
  'ticket manage settings': manage('tickets'),
  'ticket workflow enable': manage('tickets'),
  'ticket workflow disable': manage('tickets'),
  'ticket workflow add-status': manage('tickets'),
  'ticket workflow remove-status': manage('tickets'),
  'ticket workflow settings': manage('tickets'),
  'ticket workflow autoclose-enable': manage('tickets'),
  'ticket workflow autoclose-disable': manage('tickets'),
  'ticket sla enable': manage('tickets'),
  'ticket sla disable': manage('tickets'),
  'ticket sla per-type': manage('tickets'),
  'ticket sla stats': manage('tickets'),
  'ticket routing enable': manage('tickets'),
  'ticket routing disable': manage('tickets'),
  'ticket routing rule-add': manage('tickets'),
  'ticket routing rule-remove': manage('tickets'),
  'ticket routing strategy': manage('tickets'),
  'ticket routing stats': manage('tickets'),
  'Open Ticket For User': use('tickets'),
  'Manage Restrictions': manage('tickets'),

  // --- applications ---
  'application-setup': manage('applications'),
  'application position add': manage('applications'),
  'application position remove': manage('applications'),
  'application position toggle': manage('applications'),
  'application position edit': manage('applications'),
  'application position fields': manage('applications'),
  'application position list': manage('applications'),
  'application position refresh': manage('applications'),
  'application position reindex': manage('applications'),
  'application status': manage('applications'),
  'application note': manage('applications'),
  'application claim': manage('applications'),
  'application info': use('applications'),
  'application check': { publicReason: "applicant self-check: reads only the caller's own open application" },
  'application workflow-enable': manage('applications'),
  'application workflow-disable': manage('applications'),
  'application workflow-add-status': manage('applications'),
  'application workflow-remove-status': manage('applications'),

  // --- announcements ---
  'announcement-setup': manage('announcements'),
  'announcement template create': manage('announcements'),
  'announcement template edit': manage('announcements'),
  'announcement template delete': manage('announcements'),
  'announcement template list': use('announcements'),
  'announcement template preview': manage('announcements'),
  'announcement template reset': manage('announcements'),
  'announcement send': manage('announcements'),

  // --- bait channel (router guard is manage; raid enter/release need admin) ---
  'baitchannel setup setup': manage('baitchannel'),
  'baitchannel setup toggle': manage('baitchannel'),
  'baitchannel setup add-channel': manage('baitchannel'),
  'baitchannel setup remove-channel': manage('baitchannel'),
  'baitchannel setup status': manage('baitchannel'),
  'baitchannel detection detection': manage('baitchannel'),
  'baitchannel detection whitelist': manage('baitchannel'),
  'baitchannel detection keywords': manage('baitchannel'),
  'baitchannel detection settings': manage('baitchannel'),
  'baitchannel detection test-mode': manage('baitchannel'),
  'baitchannel escalation enable': manage('baitchannel'),
  'baitchannel escalation disable': manage('baitchannel'),
  'baitchannel escalation thresholds': manage('baitchannel'),
  'baitchannel dm enable': manage('baitchannel'),
  'baitchannel dm disable': manage('baitchannel'),
  'baitchannel dm appeal-info': manage('baitchannel'),
  'baitchannel dm clear-appeal': manage('baitchannel'),
  'baitchannel stats stats': manage('baitchannel'),
  'baitchannel stats summary': manage('baitchannel'),
  'baitchannel stats override': manage('baitchannel'),
  'baitchannel raid status': manage('baitchannel'),
  'baitchannel raid enter': admin('baitchannel'),
  'baitchannel raid release': admin('baitchannel'),
  'View Bait Score': use('baitchannel'),

  // --- memory ---
  'memory-setup setup': manage('memory'),
  'memory-setup add-channel': manage('memory'),
  'memory-setup remove-channel': manage('memory'),
  'memory-setup view': manage('memory'),
  'memory-setup tag-add': manage('memory'),
  'memory-setup tag-remove': manage('memory'),
  'memory-setup tag-edit': manage('memory'),
  'memory-setup tag-list': manage('memory'),
  'memory-setup tag-reset': manage('memory'),
  'memory add': manage('memory'),
  'memory capture': manage('memory'),
  'memory update': manage('memory'),
  'memory update-status': manage('memory'),
  'memory update-tags': manage('memory'),
  'memory delete': manage('memory'),
  'memory tags': manage('memory'),
  'Capture to Memory': use('memory'),

  // --- rules ---
  'rules-setup setup': manage('rules'),
  'rules-setup view': use('rules'),
  'rules-setup remove': manage('rules'),

  // --- reaction roles ---
  'reactionrole create': manage('reactionroles'),
  'reactionrole add': manage('reactionroles'),
  'reactionrole remove': manage('reactionroles'),
  'reactionrole edit': manage('reactionroles'),
  'reactionrole delete': manage('reactionroles'),
  'reactionrole list': use('reactionroles'),
  'reactionrole validate': manage('reactionroles'),

  // --- starboard ---
  'starboard setup': manage('starboard'),
  'starboard config': manage('starboard'),
  'starboard ignore': manage('starboard'),
  'starboard unignore': manage('starboard'),
  'starboard stats': use('starboard'),
  'starboard toggle': manage('starboard'),
  'starboard random': use('starboard'),

  // --- xp ---
  'xp-setup enable': manage('xp'),
  'xp-setup disable': manage('xp'),
  'xp-setup config': manage('xp'),
  'xp-setup role-reward-add': manage('xp'),
  'xp-setup role-reward-remove': manage('xp'),
  'xp-setup role-reward-list': manage('xp'),
  'xp-setup ignore-channel-add': manage('xp'),
  'xp-setup ignore-channel-remove': manage('xp'),
  'xp-setup multiplier-set': manage('xp'),
  'xp-setup multiplier-remove': manage('xp'),
  'xp set': admin('xp'),
  'xp reset': admin('xp'),
  'xp reset-all': admin('xp'),
  rank: { publicReason: 'member XP rank card' },
  leaderboard: { publicReason: 'member XP leaderboard' },

  // --- onboarding (router guard) ---
  'onboarding enable': manage('onboarding'),
  'onboarding disable': manage('onboarding'),
  'onboarding welcome-message': manage('onboarding'),
  'onboarding completion-role': manage('onboarding'),
  'onboarding step-add': manage('onboarding'),
  'onboarding step-remove': manage('onboarding'),
  'onboarding step-list': manage('onboarding'),
  'onboarding stats': manage('onboarding'),
  'onboarding preview': manage('onboarding'),
  'onboarding resend': manage('onboarding'),

  // --- automod (router guard) ---
  'automod rule create': manage('automod'),
  'automod rule edit': manage('automod'),
  'automod rule delete': manage('automod'),
  'automod rule list': manage('automod'),
  'automod template apply': manage('automod'),
  'automod backup export': manage('automod'),
  'automod backup restore': manage('automod'),
  'automod keyword add': manage('automod'),
  'automod keyword remove': manage('automod'),
  'automod regex add': manage('automod'),
  'automod regex remove': manage('automod'),
  'automod exempt add': manage('automod'),
  'automod exempt remove': manage('automod'),

  // --- events ---
  'event template create': manage('events'),
  'event template edit': manage('events'),
  'event template delete': manage('events'),
  'event template list': manage('events'),
  'event setup enable': manage('events'),
  'event setup disable': manage('events'),
  'event setup reminder-channel': manage('events'),
  'event setup summary-channel': manage('events'),
  'event setup default-reminder': manage('events'),
  'event create': manage('events'),
  'event from-template': manage('events'),
  'event cancel': manage('events'),
  'event remind': manage('events'),
  'event recurring': manage('events'),

  // --- analytics (router 'use'; setup escalates to manage) ---
  'analytics overview': use('analytics'),
  'analytics growth': use('analytics'),
  'analytics channels': use('analytics'),
  'analytics hours': use('analytics'),
  'analytics setup': manage('analytics'),

  // --- utility ---
  ping: { publicReason: 'latency check' },
  coffee: { publicReason: 'donation link' },
  dashboard: { publicReason: 'web dashboard link' },
  server: { admin: true },
};

/**
 * Commands that flag an option for autocomplete but have no autocomplete
 * route, so nobody gets suggestions. Listed so the "granted member reaches the
 * route" check skips them on purpose.
 */
const AUTOCOMPLETE_UNROUTED = new Set(['onboarding']);

// ---------------------------------------------------------------------------
// Registry walk
// ---------------------------------------------------------------------------

type Kind = 'slash' | 'user' | 'message';

interface PathEntry {
  key: string;
  kind: Kind;
  name: string;
  group: string | null;
  sub: string | null;
  autocompleteOptions: string[];
}

interface CommandJson {
  name: string;
  type?: number;
  default_member_permissions?: string | null;
  options?: OptionJson[];
}

interface OptionJson {
  type: number;
  name: string;
  autocomplete?: boolean;
  options?: OptionJson[];
}

const SUB_COMMAND = 1;
const SUB_COMMAND_GROUP = 2;

function toJson(cmd: unknown): CommandJson {
  const c = cmd as { toJSON?: () => CommandJson };
  return typeof c.toJSON === 'function' ? c.toJSON() : (cmd as CommandJson);
}

function autocompleteNames(options: OptionJson[] | undefined): string[] {
  return (options ?? []).filter(o => o.autocomplete).map(o => o.name);
}

function walkCommand(json: CommandJson): PathEntry[] {
  const kind: Kind = json.type === 2 ? 'user' : json.type === 3 ? 'message' : 'slash';
  const base = { kind, name: json.name };
  const subs: PathEntry[] = [];

  for (const opt of json.options ?? []) {
    if (opt.type === SUB_COMMAND_GROUP) {
      for (const sub of opt.options ?? []) {
        subs.push({
          ...base,
          key: `${json.name} ${opt.name} ${sub.name}`,
          group: opt.name,
          sub: sub.name,
          autocompleteOptions: autocompleteNames(sub.options),
        });
      }
    } else if (opt.type === SUB_COMMAND) {
      subs.push({
        ...base,
        key: `${json.name} ${opt.name}`,
        group: null,
        sub: opt.name,
        autocompleteOptions: autocompleteNames(opt.options),
      });
    }
  }

  if (subs.length > 0) return subs;
  return [{ ...base, key: json.name, group: null, sub: null, autocompleteOptions: autocompleteNames(json.options) }];
}

const registry = commands.map(toJson);
const visibleCommands = registry.filter(c => c.default_member_permissions == null);
const hiddenCommands = registry.filter(c => c.default_member_permissions != null);
const visiblePaths = visibleCommands.flatMap(walkCommand);

function isFeatureGuard(guard: Guard): guard is { feature: Feature; level: Level } {
  return 'feature' in guard;
}

const guardedPaths = visiblePaths.filter(p => GUARDS[p.key] && !('publicReason' in GUARDS[p.key]));
const leveledPaths = guardedPaths.filter(p => {
  const guard = GUARDS[p.key];
  return isFeatureGuard(guard) && guard.level !== 'use';
});
const autocompletePaths = visiblePaths.filter(p => p.autocompleteOptions.length > 0);

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

type PermissionRow = Pick<GuildPermission, 'guildId' | 'roleId' | 'feature' | 'level'>;

/** guildId → grant rows the fake GuildPermission repository returns. */
const grants = new Map<string, PermissionRow[]>();
/** Entities other than GuildPermission that code asked the DataSource for. */
const otherRepoRequests: string[] = [];
/** Overrides for the /application check case. */
const repoOverrides = new Map<unknown, unknown>();

let counter = 0;
/** Fresh guild/user ids per case: no shared permission cache or rate-limit key. */
function nextIds() {
  counter += 1;
  return { guildId: `9000000000000${counter}`, userId: `8000000000000${counter}` };
}

interface Ctx {
  guildId: string;
  userId: string;
  roleIds: string[];
}

interface Response {
  method: string;
  payload: { content?: string; flags?: unknown[] } & Record<string, unknown>;
}

function makeOptions(entry: PathEntry) {
  return {
    getSubcommandGroup: (required?: boolean) => {
      if (entry.group === null && required) throw new Error('no subcommand group');
      return entry.group;
    },
    getSubcommand: (required = true) => {
      if (entry.sub === null && required) throw new Error('no subcommand');
      return entry.sub;
    },
    getString: (_name: string, required?: boolean) => (required ? 'value' : null),
    getInteger: (_name: string, required?: boolean) => (required ? 1 : null),
    getNumber: (_name: string, required?: boolean) => (required ? 1 : null),
    getBoolean: (_name: string, required?: boolean) => (required ? false : null),
    getChannel: (_name: string, required?: boolean) => (required ? { id: '7000000000000001', type: 0 } : null),
    getRole: (_name: string, required?: boolean) => (required ? { id: '7000000000000002' } : null),
    getUser: (_name: string, required?: boolean) => (required ? { id: '7000000000000003' } : null),
    getMember: () => null,
    getMentionable: () => null,
    getAttachment: () => null,
    getFocused: (full?: boolean) => (full ? { name: entry.autocompleteOptions[0] ?? 'value', value: '' } : ''),
  };
}

function makeInteraction(entry: PathEntry, ctx: Ctx) {
  const responses: Response[] = [];
  const record =
    (method: string) =>
    async (payload: Response['payload'] = {}) => {
      responses.push({ method, payload });
      interaction.replied = true;
      return { resource: { message: null } };
    };

  const interaction = {
    commandName: entry.name,
    guildId: ctx.guildId,
    guild: { id: ctx.guildId, name: 'Test Guild' },
    channelId: '7000000000000010',
    channel: { id: '7000000000000010' },
    client: { user: { id: '7000000000000099' } },
    user: { id: ctx.userId, tag: 'member#0001', username: 'member', displayName: 'member' },
    member: {
      id: ctx.userId,
      // Never a Discord Administrator: admins skip every feature check.
      permissions: { has: () => false },
      roles: { cache: new Map(ctx.roleIds.map(id => [id, { id }])) },
    },
    options: makeOptions(entry),
    targetUser: { id: '7000000000000003', displayName: 'target', toString: () => '<@7000000000000003>' },
    targetMessage: { id: '7000000000000004', channelId: '7000000000000010', content: 'hi', author: null },
    replied: false,
    deferred: false,
    isRepliable: () => true,
    inGuild: () => true,
    inCachedGuild: () => true,
    isChatInputCommand: () => entry.kind === 'slash',
    isUserContextMenuCommand: () => entry.kind === 'user',
    isMessageContextMenuCommand: () => entry.kind === 'message',
    reply: record('reply'),
    deferReply: record('deferReply'),
    editReply: record('editReply'),
    followUp: record('followUp'),
    showModal: record('showModal'),
    update: record('update'),
    respond: record('respond'),
    awaitModalSubmit: () => Promise.reject(new Error('no modal in tests')),
  };
  return { interaction, responses };
}

async function run(entry: PathEntry, ctx: Ctx) {
  const { interaction, responses } = makeInteraction(entry, ctx);
  otherRepoRequests.length = 0;
  if (entry.kind === 'slash') {
    await dispatchCommand({} as never, interaction as never, entry.name);
  } else {
    await handleContextMenuCommand({} as never, interaction as never);
  }
  return responses;
}

function expectSingleRefusal(responses: Response[], content: string) {
  expect(responses).toHaveLength(1);
  expect(responses[0].method).toBe('reply');
  expect(responses[0].payload.flags).toContain(MessageFlags.Ephemeral);
  expect(responses[0].payload.content).toBe(content);
  // Refused before any other table was read.
  expect(otherRepoRequests).toEqual([]);
}

const ADMIN_REQUIRED = '❌ This command requires **Administrator** permission.';
const noGrantMessage = (feature: Feature) => `❌ You don't have permission to use the **${feature}** feature.`;
const tooLowMessage = (feature: Feature, level: Level) =>
  `❌ This action requires at least **${level}** access to the **${feature}** feature.`;
const ONE_BELOW: Record<Level, Level> = { use: 'use', manage: 'use', admin: 'manage' };

// ---------------------------------------------------------------------------
// DataSource seam
// ---------------------------------------------------------------------------

type GetRepository = (entity: unknown) => unknown;
const ds = AppDataSource as unknown as { getRepository: GetRepository };
let originalGetRepository: GetRepository;
let seamActive = false;

const entityName = (entity: unknown) => (entity as { name?: string })?.name ?? String(entity);

/**
 * A repository a lazyRepo may cache: while this suite runs it serves the
 * override; afterwards it forwards to the getRepository installed then.
 */
function forwardingRepo(entity: unknown): object {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        const repo = (seamActive ? repoOverrides.get(entity) : ds.getRepository(entity)) as Record<
          string | symbol,
          unknown
        >;
        if (!repo) throw new Error(`commandVisibility: no ${entityName(entity)} fake installed`);
        const value = repo[prop];
        return typeof value === 'function' ? value.bind(repo) : value;
      },
    },
  );
}

beforeAll(() => {
  originalGetRepository = ds.getRepository;
  seamActive = true;
  ds.getRepository = (entity: unknown) => {
    if (entity === GuildPermission) {
      return {
        find: async (opts: { where: { guildId: string } }) => grants.get(opts.where.guildId) ?? [],
      };
    }
    if (repoOverrides.has(entity)) return forwardingRepo(entity);
    otherRepoRequests.push(entityName(entity));
    throw new Error(`commandVisibility: no ${entityName(entity)} repository in this suite`);
  };
});

afterAll(() => {
  seamActive = false;
  ds.getRepository = originalGetRepository;
});

// ---------------------------------------------------------------------------
// 1. Registry partition
// ---------------------------------------------------------------------------

describe('command registry visibility', () => {
  test('only meta and destructive commands keep a default permission', () => {
    expect(hiddenCommands.map(c => c.name).sort()).toEqual([...HIDDEN_COMMANDS].sort());
  });

  test('every visible command path has a guard row, and no row is stale', () => {
    const keys = visiblePaths.map(p => p.key);
    expect(keys.filter(k => !(k in GUARDS))).toEqual([]);
    expect(Object.keys(GUARDS).filter(k => !keys.includes(k))).toEqual([]);
  });

  test('feature commands and all four context menus are visible to members', () => {
    for (const name of ['ticket', 'application', 'xp', 'starboard', 'Open Ticket For User', 'Capture to Memory']) {
      expect(visibleCommands.map(c => c.name)).toContain(name);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Every guarded path refuses members without a grant
// ---------------------------------------------------------------------------

describe('visible commands refuse members without a grant', () => {
  test.each(
    guardedPaths.map(p => [p.key, p] as const),
  )('%s: unconfigured guild falls back to admin-only', async (_key, entry) => {
    const ctx = { ...nextIds(), roleIds: ['7100000000000001'] };
    grants.set(ctx.guildId, []);

    expectSingleRefusal(await run(entry, ctx), ADMIN_REQUIRED);
  });

  test.each(
    guardedPaths.map(p => [p.key, p] as const),
  )('%s: configured guild, no matching role → refused for the right feature', async (key, entry) => {
    const guard = GUARDS[key];
    const ctx = { ...nextIds(), roleIds: ['7100000000000001'] };
    // A grant exists, but for a role this member doesn't have.
    grants.set(ctx.guildId, [
      {
        guildId: ctx.guildId,
        roleId: '7100000000000099',
        feature: isFeatureGuard(guard) ? guard.feature : 'tickets',
        level: 'admin',
      },
    ]);

    const expected = isFeatureGuard(guard) ? noGrantMessage(guard.feature) : ADMIN_REQUIRED;
    expectSingleRefusal(await run(entry, ctx), expected);
  });

  test.each(
    leveledPaths.map(p => [p.key, p] as const),
  )('%s: a grant one level too low is refused with the required level', async (key, entry) => {
    const guard = GUARDS[key] as { feature: Feature; level: Level };
    const ctx = { ...nextIds(), roleIds: ['7100000000000002'] };
    grants.set(ctx.guildId, [
      { guildId: ctx.guildId, roleId: '7100000000000002', feature: guard.feature, level: ONE_BELOW[guard.level] },
    ]);

    expectSingleRefusal(await run(entry, ctx), tooLowMessage(guard.feature, guard.level));
  });

  test('/application check stays usable by a member with no grants', async () => {
    const entry = visiblePaths.find(p => p.key === 'application check');
    expect(entry).toBeDefined();
    const ctx = { ...nextIds(), roleIds: [] };
    grants.set(ctx.guildId, []);

    const queries: Record<string, unknown>[] = [];
    repoOverrides.set(ApplicationConfig, { findOneBy: async () => null });
    repoOverrides.set(Application, {
      createQueryBuilder: () => {
        const qb = {
          where: (_sql: string, params: Record<string, unknown>) => {
            queries.push(params);
            return qb;
          },
          andWhere: (_sql: string, params: Record<string, unknown>) => {
            queries.push(params);
            return qb;
          },
          orderBy: () => qb,
          getOne: async () => null,
        };
        return qb;
      },
    });
    try {
      const responses = await run(entry as PathEntry, ctx);

      expect(responses).toHaveLength(1);
      expect(responses[0].payload.content).toBe(applicationLang.workflow.checkNoApplication);
      // Scoped to this guild and to the caller.
      expect(queries).toContainEqual({ guildId: ctx.guildId });
      expect(queries).toContainEqual({ userId: ctx.userId });
    } finally {
      repoOverrides.clear();
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Autocomplete
// ---------------------------------------------------------------------------

describe('autocomplete on visible commands', () => {
  async function complete(entry: PathEntry, ctx: Ctx) {
    const { interaction, responses } = makeInteraction(entry, ctx);
    otherRepoRequests.length = 0;
    // Silenced spies: handlers past the gate fail on the missing database.
    const debug = spyOn(enhancedLogger, 'debug').mockImplementation(() => {});
    const error = spyOn(enhancedLogger, 'error').mockImplementation(() => {});
    try {
      await handleAutocomplete({} as never, interaction as never);
      // The dispatcher logs "Autocomplete: /…" only after the access check.
      const routed = debug.mock.calls.some(call => String(call[0]).startsWith('Autocomplete: '));
      return { responses, routed };
    } finally {
      debug.mockRestore();
      error.mockRestore();
    }
  }

  test('every autocomplete option sits on a visible, feature-guarded path', () => {
    expect(autocompletePaths.length).toBeGreaterThan(0);
    for (const entry of autocompletePaths) {
      expect(isFeatureGuard(GUARDS[entry.key])).toBe(true);
    }
  });

  test.each(
    autocompletePaths.map(p => [p.key, p] as const),
  )('%s: no suggestions for a member without a grant', async (key, entry) => {
    const guard = GUARDS[key] as { feature: Feature; level: Level };
    for (const rows of [[], [{ roleId: '7100000000000099', feature: guard.feature, level: 'admin' as Level }]]) {
      const ctx = { ...nextIds(), roleIds: ['7100000000000001'] };
      grants.set(
        ctx.guildId,
        rows.map(r => ({ ...r, guildId: ctx.guildId })),
      );

      const { responses, routed } = await complete(entry, ctx);

      expect(routed).toBe(false);
      expect(responses).toEqual([{ method: 'respond', payload: [] as never }]);
      expect(otherRepoRequests).toEqual([]);
    }
  });

  test.each(
    autocompletePaths.filter(p => !AUTOCOMPLETE_UNROUTED.has(p.name)).map(p => [p.key, p] as const),
  )('%s: a member with a use grant on the feature reaches the route', async (key, entry) => {
    const guard = GUARDS[key] as { feature: Feature; level: Level };
    const ctx = { ...nextIds(), roleIds: ['7100000000000003'] };
    grants.set(ctx.guildId, [
      { guildId: ctx.guildId, roleId: '7100000000000003', feature: guard.feature, level: 'use' },
    ]);

    const { routed } = await complete(entry, ctx);

    expect(routed).toBe(true);
  });
});

/**
 * /bot-setup system flows (NindroidA/cogworks-bot#41, audits 116, 118, 120, 123, 124).
 *
 * - 116: an auto-create that can't finish (missing channel or a later error)
 *   deletes the partial set and reports failure, naming what it couldn't delete.
 * - 118: re-running the bait flow keeps the extra bait channels and the banner;
 *   a moved banner is deleted only after the new config is saved.
 * - 120: re-running ticket setup posts and saves the new panel and archive
 *   thread before deleting the old ones; a failed post keeps the old panel
 *   tracked, and an old panel that can't be deleted is reported.
 * - 123: unchecking "Enable Staff Role" turns the global staff role off.
 * - 124: the rules step tells the admin to finish with /rules-setup.
 *
 * Strategy: patch AppDataSource.getRepository with stable in-memory repos
 * (lazyRepo caches the first repo it gets, so each entity keeps one stub over
 * a mutable table) and drive runSystemFlow with interaction doubles.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { ChannelType, Collection, PermissionFlagsBits } from 'discord.js';

type Row = Record<string, any>;
const GUILD = 'g-flows';
const STAFF = '111111111111111111';

const tables: Record<string, Row[]> = {};
/** Last row each entity saved, copied at save time (the live rows are mutated in place). */
const saved: Record<string, Row> = {};
const failSave = new Set<string>();
const matches = (row: Row, where: Row = {}) => Object.entries(where).every(([k, v]) => row[k] === v);

function makeRepo(name: string) {
  const rows = () => (tables[name] ??= []);
  return {
    findOne: async (opts: { where?: Row } = {}) => rows().find(r => matches(r, opts.where)) ?? null,
    findOneBy: async (where: Row) => rows().find(r => matches(r, where)) ?? null,
    find: async (opts: { where?: Row } = {}) => rows().filter(r => matches(r, opts.where)),
    count: async () => 1, // BaitKeyword: seeding sees existing keywords and skips
    create: (obj: Row) => ({ ...obj }),
    save: async (entity: Row) => {
      if (failSave.has(name)) throw new Error(`boom-save-${name}`);
      if (!rows().includes(entity)) rows().push(entity);
      saved[name] = { ...entity };
      return entity;
    },
  };
}

const repos: Record<string, ReturnType<typeof makeRepo>> = {};
const repoFor = (entity: any) => (repos[entity?.name ?? 'unknown'] ??= makeRepo(entity?.name ?? 'unknown'));

let runSystemFlow: typeof import('../../../../src/commands/handlers/botSetup/systemFlows').runSystemFlow;
let originalGetRepository: ((entity: any) => unknown) | undefined;

beforeAll(async () => {
  const { AppDataSource } = await import('../../../../src/typeorm');
  const ds = AppDataSource as unknown as { getRepository: (e: any) => unknown };
  originalGetRepository = ds.getRepository;
  ds.getRepository = repoFor;
  runSystemFlow = (await import('../../../../src/commands/handlers/botSetup/systemFlows')).runSystemFlow;
});

afterAll(async () => {
  const { AppDataSource } = await import('../../../../src/typeorm');
  if (originalGetRepository) {
    (AppDataSource as unknown as { getRepository: (e: any) => unknown }).getRepository = originalGetRepository;
  }
});

beforeEach(() => {
  for (const key of Object.keys(tables)) delete tables[key];
  for (const key of Object.keys(saved)) delete saved[key];
  failSave.clear();
});

afterEach(async () => {
  // saveSetupState queues a debounced command refresh; drop it before it fires
  const { clearGuildCommandSignature } = await import('../../../../src/utils/setup/commandGating');
  clearGuildCommandSignature(GUILD);
});

// ---------------------------------------------------------------------------
// Discord doubles
// ---------------------------------------------------------------------------

const unknown = (code: number) => Object.assign(new Error('Unknown'), { code });

function makeGuild(
  opts: {
    failTypes?: ChannelType[];
    failSendIn?: string[];
    /** Ids whose delete fails with Missing Permissions. */
    failDelete?: string[];
    failCategoryDelete?: boolean;
    /** Called as each object is deleted, to see what was saved by then. */
    onDelete?: (id: string) => void;
  } = {},
) {
  let seq = 0;
  const deleted: string[] = [];
  const created: Row[] = [];
  const cache = new Collection<string, any>();
  const remove = (id: string) => {
    if (opts.failDelete?.includes(id)) throw new Error('50013: Missing Permissions');
    opts.onDelete?.(id);
    deleted.push(id);
  };
  const makeMessage = (id: string, messages: Map<string, Row>) => {
    const message: Row = { id, edits: 0 };
    message.edit = async () => {
      message.edits++;
    };
    message.delete = async () => {
      remove(id);
      messages.delete(id);
    };
    messages.set(id, message);
    return message;
  };

  const textChannel = (id: string) => {
    const messages = new Map<string, Row>();
    const channel: Row = {
      id,
      name: id,
      type: ChannelType.GuildText,
      isTextBased: () => true,
      isThread: () => false,
      sent: [] as string[],
      messages: {
        fetch: async (messageId: string) => {
          const message = messages.get(messageId);
          if (!message) throw unknown(10008);
          return message;
        },
      },
      send: async () => {
        if (opts.failSendIn?.includes(id)) throw new Error('50013: Missing Permissions');
        const message = makeMessage(`${id}-msg-${++seq}`, messages);
        channel.sent.push(message.id);
        return message;
      },
      seedMessage: (messageId: string) => makeMessage(messageId, messages),
      delete: async () => remove(id),
    };
    return channel;
  };

  const thread = (id: string) => ({
    id,
    isThread: () => true,
    isTextBased: () => true,
    pin: async () => {},
    delete: async () => {
      remove(id);
      cache.delete(id);
    },
  });

  const forum = (id: string) => ({
    id,
    type: ChannelType.GuildForum,
    isTextBased: () => false,
    isThread: () => false,
    threads: {
      create: async () => {
        const t = thread(`${id}-thread-${++seq}`);
        cache.set(t.id, t);
        return t;
      },
    },
    delete: async () => remove(id),
  });

  const add = (channel: Row) => {
    cache.set(channel.id, channel);
    return channel;
  };

  const guild: any = {
    id: GUILD,
    features: [],
    roles: { cache: new Collection([[STAFF, { id: STAFF }]]) },
    members: { me: { id: 'bot-1', permissions: { has: () => true } } },
    client: { user: { id: 'bot-1' } },
    deleted,
    created,
    add,
    textChannel: (id: string) => add(textChannel(id)),
    forum: (id: string) => add(forum(id)),
    thread: (id: string) => add(thread(id)),
    channels: {
      cache,
      fetch: async (id: string) => {
        const channel = cache.get(id);
        if (!channel) throw unknown(10003);
        return channel;
      },
      create: async (options: Row) => {
        if (opts.failTypes?.includes(options.type)) throw new Error('50013: Missing Permissions');
        created.push(options);
        const id = `auto-${++seq}`;
        if (options.type === ChannelType.GuildForum) return add(forum(id));
        if (options.type === ChannelType.GuildCategory) {
          const del = async () => {
            if (opts.failCategoryDelete) throw new Error('50013: Missing Permissions');
            remove(id);
          };
          return add({ id, type: ChannelType.GuildCategory, delete: del });
        }
        return add(textChannel(id));
      },
    },
  };
  return guild;
}

interface Run {
  result: { updated: boolean; failed?: boolean; states: Row };
  followUps: string[];
}

/** Drive one /bot-setup system flow. `fields` answers the modal; `autoCreate` picks "Create Channels For Me". */
async function runFlow(
  systemId: string,
  guild: any,
  opts: { fields?: Record<string, unknown>; autoCreate?: boolean; setupState?: Row } = {},
): Promise<Run> {
  const followUps: string[] = [];
  const fields = opts.fields ?? {};
  const submit = {
    guild,
    fields: { getField: (id: string) => (id in fields ? fields[id] : null) },
    deferUpdate: async () => {},
    followUp: async (p: Row) => {
      followUps.push(p.content);
    },
  };
  const user = { id: 'admin-1' };
  const btn: any = {
    customId: opts.autoCreate ? 'setup_ch_create' : 'setup_ch_existing',
    user,
    guild,
    replied: false,
    deferred: false,
    update: async () => {
      btn.replied = true;
    },
    showModal: async () => {
      btn.replied = true;
    },
    awaitModalSubmit: async () => submit,
    followUp: async (p: Row) => {
      followUps.push(p.content);
    },
  };
  const menu: any = {
    customId: 'setup_system_select',
    values: [systemId],
    user,
    guild,
    replied: false,
    deferred: false,
    update: async () => {
      menu.replied = true;
    },
    showModal: async () => {
      menu.replied = true;
    },
    awaitModalSubmit: async () => submit,
    editReply: async () => {},
    followUp: async () => {},
    channel: { awaitMessageComponent: async () => btn },
  };
  const setupState = opts.setupState ?? { guildId: GUILD, systemStates: {}, partialData: {} };
  const result = await runSystemFlow(systemId, menu, {} as any, GUILD, setupState as any);
  return { result: result as Run['result'], followUps };
}

const select = (id: string) => ({ values: [id] });

// ---------------------------------------------------------------------------
// audit 123 — Staff Role
// ---------------------------------------------------------------------------

describe('Staff Role step (audit 123)', () => {
  test('unchecking Enable Staff Role turns the global staff role off', async () => {
    tables.BotConfig = [{ guildId: GUILD, enableGlobalStaffRole: true, globalStaffRole: 'staff-1' }];
    const setupState = {
      guildId: GUILD,
      systemStates: { staffRole: 'complete' },
      partialData: { staffRole: { roleId: 'staff-1' } },
    };

    const { result } = await runFlow('staffRole', makeGuild(), {
      fields: { setup_staff_enable: { value: false } },
      setupState,
    });

    expect(tables.BotConfig[0]).toMatchObject({ enableGlobalStaffRole: false, globalStaffRole: null });
    expect(result.updated).toBe(true);
    expect(result.states.staffRole).toBe('not_started');
    expect(setupState.partialData.staffRole).toBeUndefined(); // else the dashboard shows "In Progress"
  });

  test('enabled with no role picked saves nothing and says what to do', async () => {
    tables.BotConfig = [{ guildId: GUILD, enableGlobalStaffRole: false, globalStaffRole: null }];

    const { result, followUps } = await runFlow('staffRole', makeGuild(), {
      fields: { setup_staff_enable: { value: true } },
    });

    expect(result.updated).toBe(false);
    expect(tables.BotConfig[0].enableGlobalStaffRole).toBe(false);
    expect(followUps).toHaveLength(1);
    expect(followUps[0]).toContain('Enable Staff Role');
  });
});

// ---------------------------------------------------------------------------
// audits 116 + 120 — Ticket System
// ---------------------------------------------------------------------------

describe('Ticket System flow (audits 116, 120)', () => {
  const ticketFields = (channelId: string, archiveId: string, categoryId: string) => ({
    setup_ticket_ch: select(channelId),
    setup_ticket_archive: select(archiveId),
    setup_ticket_cat: select(categoryId),
  });

  test('auto-create that cannot make the archive forum deletes what it made and reports failure', async () => {
    const guild = makeGuild({ failTypes: [ChannelType.GuildForum] });

    const { result } = await runFlow('ticket', guild, { autoCreate: true });

    expect(result).toMatchObject({ updated: false, failed: true });
    expect(guild.created).toHaveLength(3); // two categories + the panel channel
    expect(guild.deleted).toHaveLength(3);
    expect(tables.TicketConfig ?? []).toHaveLength(0);
  });

  test('auto-create opens staff-only channels to the global staff role', async () => {
    tables.BotConfig = [{ guildId: GUILD, enableGlobalStaffRole: true, globalStaffRole: `<@&${STAFF}>` }];
    const guild = makeGuild();

    const { result } = await runFlow('ticket', guild, { autoCreate: true });

    expect(result.updated).toBe(true);
    const category = guild.created.find((c: Row) => c.type === ChannelType.GuildCategory);
    expect(category.permissionOverwrites).toContainEqual(
      expect.objectContaining({ id: STAFF, allow: [PermissionFlagsBits.ViewChannel] }),
    );
  });

  test('a re-run replaces the old panel and archive thread instead of adding a second', async () => {
    // What was saved when each old object was deleted: the new ids must already be stored,
    // or the messageDelete cleaner's stale save could write the old row back
    const savedAtDelete: Record<string, Row> = {};
    const guild = makeGuild({
      onDelete: id => {
        savedAtDelete[id] = { ticket: { ...saved.TicketConfig }, archive: { ...saved.ArchivedTicketConfig } };
      },
    });
    const tickets = guild.textChannel('tickets');
    guild.forum('archive');
    guild.add({ id: 'cat', type: ChannelType.GuildCategory });
    await tickets.seedMessage('old-panel');
    guild.thread('old-thread');
    tables.TicketConfig = [{ guildId: GUILD, channelId: 'tickets', messageId: 'old-panel', categoryId: 'cat' }];
    tables.ArchivedTicketConfig = [{ guildId: GUILD, channelId: 'archive', messageId: 'old-thread' }];

    const { result } = await runFlow('ticket', guild, { fields: ticketFields('tickets', 'archive', 'cat') });

    expect(result.updated).toBe(true);
    expect(guild.deleted).toEqual(['old-panel', 'old-thread']);
    expect(tickets.sent).toHaveLength(1);
    expect(tables.TicketConfig[0].messageId).toBe(tickets.sent[0]);
    expect(tables.ArchivedTicketConfig[0].messageId).toMatch(/^archive-thread-/);
    expect(savedAtDelete['old-panel'].ticket.messageId).toBe(tickets.sent[0]);
    expect(savedAtDelete['old-thread'].archive.messageId).toMatch(/^archive-thread-/);
  });

  test('a panel that could not be posted keeps the old panel up and tracked', async () => {
    const guild = makeGuild({ failSendIn: ['new-tickets'] });
    const tickets = guild.textChannel('tickets');
    guild.textChannel('new-tickets');
    guild.forum('archive');
    await tickets.seedMessage('old-panel');
    tables.TicketConfig = [{ guildId: GUILD, channelId: 'tickets', messageId: 'old-panel', categoryId: 'cat' }];

    const { followUps } = await runFlow('ticket', guild, { fields: ticketFields('new-tickets', 'archive', 'cat') });

    expect(guild.deleted).not.toContain('old-panel');
    expect(tables.TicketConfig[0]).toMatchObject({ channelId: 'tickets', messageId: 'old-panel' });
    expect(followUps).toHaveLength(1);
    expect(followUps[0]).toContain('<#new-tickets>');
  });

  test('an old panel that could not be deleted is reported', async () => {
    const guild = makeGuild({ failDelete: ['old-panel'] });
    const tickets = guild.textChannel('tickets');
    guild.forum('archive');
    await tickets.seedMessage('old-panel');
    tables.TicketConfig = [{ guildId: GUILD, channelId: 'tickets', messageId: 'old-panel', categoryId: 'cat' }];

    const { followUps } = await runFlow('ticket', guild, { fields: ticketFields('tickets', 'archive', 'cat') });

    expect(tables.TicketConfig[0].messageId).toBe(tickets.sent[0]);
    expect(followUps).toHaveLength(1);
    expect(followUps[0]).toContain("couldn't delete the old one in <#tickets>");
  });

  test('an error after the channels were made still removes them', async () => {
    failSave.add('TicketConfig');
    const guild = makeGuild();

    const { result } = await runFlow('ticket', guild, { autoCreate: true });

    expect(result).toMatchObject({ updated: false, failed: true });
    expect(guild.deleted.filter((id: string) => /^auto-\d+$/.test(id))).toHaveLength(4);
  });

  test('channels the rollback could not delete are named', async () => {
    const guild = makeGuild({ failTypes: [ChannelType.GuildForum], failCategoryDelete: true });

    const { followUps } = await runFlow('ticket', guild, { autoCreate: true });

    expect(followUps).toHaveLength(1);
    expect(followUps[0]).toContain("couldn't delete these channels");
    expect(followUps[0]).toContain('<#auto-1>');
    expect(followUps[0]).toContain('<#auto-2>');
  });
});

// ---------------------------------------------------------------------------
// audit 118 — Bait Channel
// ---------------------------------------------------------------------------

describe('Bait Channel re-run (audit 118)', () => {
  const baitFields = (channelId: string, action = 'kick') => ({
    setup_bait_ch: select(channelId),
    setup_bait_action: { value: action },
  });

  function seedBait(guild: any) {
    const a = guild.textChannel('bait-a');
    guild.textChannel('bait-b');
    guild.textChannel('bait-c');
    tables.BaitChannelConfig = [
      {
        guildId: GUILD,
        enabled: true,
        channelId: 'bait-a',
        channelIds: ['bait-a', 'bait-b', 'bait-c'],
        channelMessageId: 'banner-a',
        actionType: 'ban',
      },
    ];
    a.seedMessage('banner-a');
    return a;
  }

  test('same channel: keeps the other bait channels and the existing banner', async () => {
    const guild = makeGuild();
    const a = await seedBait(guild);

    await runFlow('baitchannel', guild, { fields: baitFields('bait-a') });

    const config = tables.BaitChannelConfig[0];
    expect(config.channelIds).toEqual(['bait-a', 'bait-b', 'bait-c']);
    expect(config.actionType).toBe('kick');
    expect(config.channelMessageId).toBe('banner-a');
    expect(a.sent).toHaveLength(0); // no second banner
    expect(guild.deleted).toEqual([]);
  });

  test('new channel: replaces the primary, keeps the extras and moves the banner', async () => {
    let savedAtDelete: Row | undefined;
    const guild = makeGuild({
      onDelete: id => {
        if (id === 'banner-a') savedAtDelete = { ...saved.BaitChannelConfig };
      },
    });
    await seedBait(guild);
    const d = guild.textChannel('bait-d');

    await runFlow('baitchannel', guild, { fields: baitFields('bait-d') });

    const config = tables.BaitChannelConfig[0];
    expect(config.channelIds).toEqual(['bait-d', 'bait-b', 'bait-c']);
    expect(config.channelId).toBe('bait-d');
    expect(guild.deleted).toEqual(['banner-a']);
    expect(d.sent).toHaveLength(1);
    expect(config.channelMessageId).toBe(d.sent[0]);
    // Saved before the old banner went, so the messageDelete cleaner can't revert it
    expect(savedAtDelete).toMatchObject({ channelId: 'bait-d', channelMessageId: d.sent[0] });
  });
});

// ---------------------------------------------------------------------------
// audit 124 — Rules
// ---------------------------------------------------------------------------

describe('Rules step (audit 124)', () => {
  test('points the admin at /rules-setup with the chosen channel', async () => {
    const { result, followUps } = await runFlow('rules', makeGuild(), {
      fields: { setup_rules_ch: select('rules-ch'), setup_rules_role: select('verified') },
    });

    expect(result.states.rules).toBe('partial');
    expect(followUps).toHaveLength(1);
    expect(followUps[0]).toContain('/rules-setup setup');
    expect(followUps[0]).toContain('<#rules-ch>');
  });
});

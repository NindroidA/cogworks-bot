/**
 * Memory flow regressions (v3.16.16, NindroidA/cogworks-bot#41).
 *
 * Audit findings covered:
 * - 63: /memory update-tags must acknowledge Continue before editReply.
 * - 64: with 2+ memory forums, the flow answers from the channel picker's
 *   select (update / showModal), never by replying to the slash command again.
 *   Capture resolves its target message before showing the picker.
 * - 68: the add modal's description fits the 2000-char starter message.
 * - 73: reopening a Completed (archived + locked) item unarchives and unlocks
 *   in the same edit that changes its tags (update-tags, update-status and the
 *   in-thread /memory update); any other change keeps the lock.
 * - 74: status autocomplete is scoped to the picked item's forum, and a
 *   same-named status from another forum is re-resolved by name.
 *
 * Strategy: patch AppDataSource.getRepository with in-memory fakes (same seam
 * as baitChannel/setup.test.ts) and drive the real handlers with interaction
 * doubles that enforce discord.js's acknowledgement rules: replying twice
 * throws InteractionAlreadyReplied and editReply before any reply throws
 * InteractionNotReplied, so the old double-reply bugs fail loudly here.
 * lazyRepo caches the first repo it gets, so the fakes are stable objects over
 * a mutable `db`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { ChannelType } from 'discord.js';
import { lang } from '../../../../src/lang';

type Row = Record<string, any>;
type Table = 'MemoryConfig' | 'MemoryTag' | 'MemoryItem';

const db: Record<Table, Row[]> = { MemoryConfig: [], MemoryTag: [], MemoryItem: [] };
let nextId = 1000;

const matches = (row: Row, where: Row = {}) => Object.entries(where).every(([k, v]) => row[k] === v);

function makeRepo(table: Table) {
  return {
    find: async (opts: { where?: Row } = {}) => db[table].filter(r => matches(r, opts.where)),
    findOneBy: async (where: Row) => db[table].find(r => matches(r, where)) ?? null,
    create: (obj: Row) => ({ ...obj }),
    save: async (entity: Row | Row[]) => {
      for (const e of Array.isArray(entity) ? entity : [entity]) {
        if (e.id == null) e.id = nextId++;
        if (!db[table].includes(e)) db[table].push(e);
      }
      return entity;
    },
  };
}

const fakeRepos: Record<string, unknown> = {
  MemoryConfig: makeRepo('MemoryConfig'),
  MemoryTag: makeRepo('MemoryTag'),
  MemoryItem: makeRepo('MemoryItem'),
};
const benignRepo = {
  find: async () => [],
  findOneBy: async () => null,
  findOne: async () => null,
  save: async (e: Row) => e,
  create: (e: Row) => e,
};

let handlers: {
  memoryAddHandler: typeof import('../../../../src/commands/handlers/memory/add').memoryAddHandler;
  memoryCaptureHandler: typeof import('../../../../src/commands/handlers/memory/capture').memoryCaptureHandler;
  memoryTagsHandler: typeof import('../../../../src/commands/handlers/memory/tags').memoryTagsHandler;
  memoryUpdateHandler: typeof import('../../../../src/commands/handlers/memory/update').memoryUpdateHandler;
  memoryUpdateTagsHandler: typeof import('../../../../src/commands/handlers/memory/updateTags').memoryUpdateTagsHandler;
  memoryUpdateStatusHandler: typeof import('../../../../src/commands/handlers/memory/updateStatus').memoryUpdateStatusHandler;
  memoryAutocomplete: typeof import('../../../../src/commands/handlers/memory/autocomplete').memoryAutocomplete;
};
let originalGetRepository: ((entity: any) => unknown) | undefined;

beforeAll(async () => {
  const { AppDataSource } = await import('../../../../src/typeorm');
  const ds = AppDataSource as unknown as { getRepository: (e: any) => unknown };
  originalGetRepository = ds.getRepository;
  ds.getRepository = (entity: any) => fakeRepos[entity?.name] ?? benignRepo;

  handlers = {
    memoryAddHandler: (await import('../../../../src/commands/handlers/memory/add')).memoryAddHandler,
    memoryCaptureHandler: (await import('../../../../src/commands/handlers/memory/capture')).memoryCaptureHandler,
    memoryTagsHandler: (await import('../../../../src/commands/handlers/memory/tags')).memoryTagsHandler,
    memoryUpdateHandler: (await import('../../../../src/commands/handlers/memory/update')).memoryUpdateHandler,
    memoryUpdateTagsHandler: (await import('../../../../src/commands/handlers/memory/updateTags'))
      .memoryUpdateTagsHandler,
    memoryUpdateStatusHandler: (await import('../../../../src/commands/handlers/memory/updateStatus'))
      .memoryUpdateStatusHandler,
    memoryAutocomplete: (await import('../../../../src/commands/handlers/memory/autocomplete')).memoryAutocomplete,
  };
});

afterAll(async () => {
  const { AppDataSource } = await import('../../../../src/typeorm');
  if (originalGetRepository) {
    (AppDataSource as unknown as { getRepository: (e: any) => unknown }).getRepository = originalGetRepository;
  }
});

beforeEach(() => {
  db.MemoryConfig = [];
  db.MemoryTag = [];
  db.MemoryItem = [];
});

// ---------------------------------------------------------------------------
// Discord doubles
// ---------------------------------------------------------------------------

interface Collector {
  handlers: Record<string, (...args: any[]) => any>;
  on: (event: string, fn: (...args: any[]) => any) => Collector;
  stop: (reason?: string) => void;
}

interface Recorder {
  calls: Array<[string, any]>;
  collector: Collector | null;
}

function makeCollector(): Collector {
  const collector: Collector = {
    handlers: {},
    on(event, fn) {
      collector.handlers[event] = fn;
      return collector;
    },
    stop() {},
  };
  return collector;
}

/** reply / deferReply / editReply / followUp / showModal with discord.js's acknowledgement rules. */
function withAckRules(target: any, rec: Recorder, response: unknown) {
  const ack = (name: string, payload: unknown) => {
    if (target.replied || target.deferred) throw new Error('InteractionAlreadyReplied');
    rec.calls.push([name, payload]);
  };
  const needAck = (name: string, payload: unknown) => {
    if (!target.replied && !target.deferred) throw new Error('InteractionNotReplied');
    rec.calls.push([name, payload]);
  };
  Object.assign(target, {
    replied: false,
    deferred: false,
    isRepliable: () => true,
    reply: async (p: unknown) => {
      ack('reply', p);
      target.replied = true;
      return response;
    },
    deferReply: async (p: unknown) => {
      ack('deferReply', p);
      target.deferred = true;
    },
    editReply: async (p: unknown) => {
      needAck('editReply', p);
      return response;
    },
    followUp: async (p: unknown) => needAck('followUp', p),
    showModal: async (m: unknown) => {
      ack('showModal', m);
      target.replied = true;
    },
    awaitModalSubmit: () => Promise.reject(new Error('time')),
  });
}

let userSeq = 0;

function makeGuild(channels: Record<string, unknown>) {
  return {
    channels: {
      fetch: async (id: string) => {
        if (!(id in channels)) throw new Error('Unknown Channel');
        return channels[id];
      },
    },
  };
}

function makeSlash(opts: { guildId: string; guild: unknown; strings?: Record<string, string>; pick?: unknown }) {
  const rec: Recorder = { calls: [], collector: null };
  const response = {
    createMessageComponentCollector: () => {
      rec.collector = makeCollector();
      return rec.collector;
    },
    awaitMessageComponent: async () => {
      if (!opts.pick) throw new Error('time');
      return opts.pick;
    },
  };
  const i: any = {
    guildId: opts.guildId,
    guild: opts.guild,
    user: { id: `user-${++userSeq}`, displayName: 'Andrew' },
    member: { permissions: { has: () => true } },
    isChatInputCommand: () => true,
    isStringSelectMenu: () => false,
    options: {
      getString: (name: string) => opts.strings?.[name] ?? null,
    },
  };
  withAckRules(i, rec, response);
  return { i, rec };
}

function makeComponent(user: { id: string }, guild: unknown, opts: { customId: string; values?: string[] }) {
  const rec: Recorder = { calls: [], collector: null };
  const response = {
    createMessageComponentCollector: () => {
      rec.collector = makeCollector();
      return rec.collector;
    },
  };
  const c: any = {
    customId: opts.customId,
    values: opts.values,
    user,
    guild,
    isChatInputCommand: () => false,
    isStringSelectMenu: () => opts.values !== undefined,
  };
  withAckRules(c, rec, response);
  c.update = async (p: unknown) => {
    if (c.replied || c.deferred) throw new Error('InteractionAlreadyReplied');
    rec.calls.push(['update', p]);
    c.replied = true;
    return response;
  };
  c.deferUpdate = async () => {
    if (c.replied || c.deferred) throw new Error('InteractionAlreadyReplied');
    rec.calls.push(['deferUpdate', null]);
    c.deferred = true;
  };
  return { c, rec };
}

function makeThread(id: string, state: { archived: boolean; locked: boolean; appliedTags: string[] }) {
  const t: any = {
    id,
    ...state,
    edits: [] as Row[],
    log: [] as string[],
    edit: async (opts: Row) => {
      if (t.archived && opts.archived !== false)
        throw new Error('50083: Operation cannot be performed on an archived thread');
      t.edits.push(opts);
      if ('archived' in opts) t.archived = opts.archived;
      if ('locked' in opts) t.locked = opts.locked;
      t.appliedTags = opts.appliedTags ?? t.appliedTags;
      return t;
    },
    setLocked: async (v: boolean) => {
      if (t.archived) throw new Error('50083');
      t.locked = v;
      t.log.push(`locked:${v}`);
    },
    setArchived: async (v: boolean) => {
      t.archived = v;
      t.log.push(`archived:${v}`);
    },
    send: async () => ({}),
  };
  return t;
}

/** The flows only fetch the forum to check it exists. */
const makeForum = (id: string) => ({ id, name: `forum-${id}` });

const tag = (
  id: number,
  memoryConfigId: number,
  name: string,
  tagType: string,
  discordTagId: string,
  guildId: string,
) => ({
  id,
  guildId,
  memoryConfigId,
  name,
  emoji: null,
  tagType,
  isDefault: true,
  discordTagId,
});

/** Two memory forums in one guild, each with its own copies of the default tags. */
function seedTwoForums(guildId: string) {
  db.MemoryConfig.push(
    { id: 501, guildId, forumChannelId: 'fa', channelName: 'Alpha', sortOrder: 0 },
    { id: 502, guildId, forumChannelId: 'fb', channelName: 'Beta', sortOrder: 1 },
  );
  db.MemoryTag.push(
    tag(511, 501, 'Bug', 'category', 'fa-bug', guildId),
    tag(512, 501, 'Open', 'status', 'fa-open', guildId),
    tag(513, 501, 'Completed', 'status', 'fa-done', guildId),
    tag(521, 502, 'Bug', 'category', 'fb-bug', guildId),
    tag(522, 502, 'Open', 'status', 'fb-open', guildId),
    tag(523, 502, 'Completed', 'status', 'fb-done', guildId),
  );
}

const callNames = (rec: Recorder) => rec.calls.map(c => c[0]);

// ---------------------------------------------------------------------------
// audit 64 — multi-forum channel picker
// ---------------------------------------------------------------------------

describe('2+ memory forums: the flow answers from the picker select (audit 64)', () => {
  function pickerSetup(strings: Record<string, string> = {}) {
    seedTwoForums('g-mf');
    const guild = makeGuild({});
    const choiceUser = { id: '' };
    const choice = makeComponent(choiceUser, guild, { customId: 'memory_channel_picker', values: ['502'] });
    const slash = makeSlash({ guildId: 'g-mf', guild, pick: choice.c, strings });
    choiceUser.id = slash.i.user.id;
    return { slash, choice, guild };
  }

  test('/memory add: picker reply, then tag selection replaces the picker; Continue opens the modal', async () => {
    const { slash, choice, guild } = pickerSetup();
    await handlers.memoryAddHandler(slash.i);

    expect(callNames(slash.rec)).toEqual(['reply']); // the picker, once
    expect(callNames(choice.rec)).toEqual(['update']);
    const shown = choice.rec.calls[0][1];
    expect(shown.components).toHaveLength(3);
    // Category options come from the picked forum (config 502)
    expect(JSON.stringify(shown.components[0])).toContain('"value":"521"');

    const collector = choice.rec.collector!;
    const category = makeComponent(choice.c.user, guild, { customId: 'memory_add_category', values: ['521'] });
    await collector.handlers.collect(category.c);
    const cont = makeComponent(choice.c.user, guild, { customId: 'memory_add_continue' });
    await collector.handlers.collect(cont.c);

    expect(cont.rec.calls[0][0]).toBe('showModal');
    const modal = cont.rec.calls[0][1].toJSON();
    // audit 68: the description fits the 2000-char starter message
    expect(modal.components[1].components[0].max_length).toBe(1800);
  });

  test('/memory tags action:add opens the modal from the picker select', async () => {
    const { slash, choice } = pickerSetup({ action: 'add' });
    await handlers.memoryTagsHandler(slash.i);

    expect(callNames(slash.rec)).toEqual(['reply']);
    expect(choice.rec.calls[0][0]).toBe('showModal');
  });

  test('/memory tags action:list replaces the picker with the tag list', async () => {
    const { slash, choice } = pickerSetup({ action: 'list' });
    await handlers.memoryTagsHandler(slash.i);

    expect(callNames(slash.rec)).toEqual(['reply']);
    expect(callNames(choice.rec)).toEqual(['update']);
    expect(JSON.stringify(choice.rec.calls[0][1].embeds)).toContain('Bug');
  });

  test('/memory capture: the target message is fetched before the picker, then the flow continues from the select', async () => {
    const { slash, choice, guild } = pickerSetup({ message: '123456789012345678' });
    const callsAtFetch: string[][] = [];
    slash.i.channelId = 'c-src';
    slash.i.channel = {
      isTextBased: () => true,
      messages: {
        fetch: async () => {
          callsAtFetch.push(callNames(slash.rec));
          return { author: { displayName: 'Sam' }, content: 'Crash on boot' };
        },
      },
    };
    await handlers.memoryCaptureHandler(slash.i);

    expect(callsAtFetch).toEqual([[]]); // fetched once, before the picker reply
    expect(callNames(slash.rec)).toEqual(['reply']); // the picker, once
    expect(callNames(choice.rec)).toEqual(['update']);
    const shown = choice.rec.calls[0][1];
    expect(JSON.stringify(shown.components[0])).toContain('"value":"521"');
    expect(JSON.stringify(shown.embeds)).toContain('Crash on boot');

    const collector = choice.rec.collector!;
    await collector.handlers.collect(
      makeComponent(choice.c.user, guild, { customId: 'memory_capture_category', values: ['521'] }).c,
    );
    const cont = makeComponent(choice.c.user, guild, { customId: 'memory_capture_continue' });
    await collector.handlers.collect(cont.c);

    expect(cont.rec.calls[0][0]).toBe('showModal');
    const modal = cont.rec.calls[0][1].toJSON();
    expect(modal.custom_id).toBe('memory_capture_modal_521_522');
    expect(modal.components[1].components[0].max_length).toBe(1800);
  });

  test('/memory capture: a bad message input is answered on the slash command, with no picker', async () => {
    const { slash, choice } = pickerSetup({ message: 'not a link' });
    await handlers.memoryCaptureHandler(slash.i);

    expect(callNames(slash.rec)).toEqual(['reply']);
    expect(slash.rec.calls[0][1].content).toContain(lang.memory.capture.invalidInput);
    expect(choice.rec.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// audit 63 + audit 73 — /memory update-tags
// ---------------------------------------------------------------------------

describe('/memory update-tags (audit 63, audit 73)', () => {
  test('Continue is acknowledged before editReply, and a Completed item is reopened', async () => {
    const guildId = 'g-ut';
    db.MemoryConfig.push({ id: 801, guildId, forumChannelId: 'f-ut', channelName: 'Memory', sortOrder: 0 });
    db.MemoryTag.push(
      tag(811, 801, 'Bug', 'category', 'd-bug', guildId),
      tag(812, 801, 'Open', 'status', 'd-open', guildId),
      tag(813, 801, 'Completed', 'status', 'd-done', guildId),
    );
    const item = { id: 1, guildId, memoryConfigId: 801, threadId: 't-ut', title: 'Crash', status: 'Completed' };
    db.MemoryItem.push(item);
    const thread = makeThread('t-ut', { archived: true, locked: true, appliedTags: ['d-done', 'manual'] });
    const guild = makeGuild({ 'f-ut': makeForum('f-ut'), 't-ut': thread });

    const slash = makeSlash({ guildId, guild, strings: { thread: 't-ut' } });
    await handlers.memoryUpdateTagsHandler(slash.i);
    const collector = slash.rec.collector!;

    const user = slash.i.user;
    await collector.handlers.collect(
      makeComponent(user, guild, { customId: 'memory_update_tags_category', values: ['811'] }).c,
    );
    await collector.handlers.collect(
      makeComponent(user, guild, { customId: 'memory_update_tags_status', values: ['812'] }).c,
    );
    const cont = makeComponent(user, guild, { customId: 'memory_update_tags_continue' });
    await collector.handlers.collect(cont.c);

    expect(callNames(cont.rec)).toEqual(['update', 'editReply']);
    expect(cont.rec.calls[1][1].content).toContain(lang.memory.quickUpdate.tagsSuccess);
    // Unarchived + unlocked in the same edit; the hand-added tag survives
    expect(thread.edits).toEqual([{ appliedTags: ['manual', 'd-bug', 'd-open'], archived: false, locked: false }]);
    expect(thread.log).toEqual([]);
    expect(item.status).toBe('Open');
  });

  test('a still-Completed item keeps its lock and is archived again', async () => {
    const guildId = 'g-ut2';
    db.MemoryConfig.push({ id: 851, guildId, forumChannelId: 'f-ut2', channelName: 'Memory', sortOrder: 0 });
    db.MemoryTag.push(
      tag(861, 851, 'Note', 'category', 'n-note', guildId),
      tag(862, 851, 'Completed', 'status', 'n-done', guildId),
    );
    db.MemoryItem.push({ id: 2, guildId, memoryConfigId: 851, threadId: 't-ut2', title: 'Doc', status: 'Completed' });
    const thread = makeThread('t-ut2', { archived: true, locked: true, appliedTags: ['n-done'] });
    const guild = makeGuild({ 'f-ut2': makeForum('f-ut2'), 't-ut2': thread });

    const slash = makeSlash({ guildId, guild, strings: { thread: 't-ut2' } });
    await handlers.memoryUpdateTagsHandler(slash.i);
    const collector = slash.rec.collector!;
    await collector.handlers.collect(
      makeComponent(slash.i.user, guild, { customId: 'memory_update_tags_category', values: ['861'] }).c,
    );
    const cont = makeComponent(slash.i.user, guild, { customId: 'memory_update_tags_continue' });
    await collector.handlers.collect(cont.c);

    expect(thread.edits).toEqual([{ appliedTags: ['n-note', 'n-done'], archived: false }]);
    expect(thread.log).toEqual(['archived:true']);
    expect(thread.locked).toBe(true);
  });

  test('a category change on an Open item keeps a lock a moderator set', async () => {
    const guildId = 'g-ut3';
    db.MemoryConfig.push({ id: 871, guildId, forumChannelId: 'f-ut3', channelName: 'Memory', sortOrder: 0 });
    db.MemoryTag.push(
      tag(881, 871, 'Bug', 'category', 'l-bug', guildId),
      tag(882, 871, 'Open', 'status', 'l-open', guildId),
    );
    db.MemoryItem.push({ id: 5, guildId, memoryConfigId: 871, threadId: 't-ut3', title: 'Heated', status: 'Open' });
    const thread = makeThread('t-ut3', { archived: false, locked: true, appliedTags: ['l-open'] });
    const guild = makeGuild({ 'f-ut3': makeForum('f-ut3'), 't-ut3': thread });

    const slash = makeSlash({ guildId, guild, strings: { thread: 't-ut3' } });
    await handlers.memoryUpdateTagsHandler(slash.i);
    const collector = slash.rec.collector!;
    await collector.handlers.collect(
      makeComponent(slash.i.user, guild, { customId: 'memory_update_tags_category', values: ['881'] }).c,
    );
    const cont = makeComponent(slash.i.user, guild, { customId: 'memory_update_tags_continue' });
    await collector.handlers.collect(cont.c);

    expect(thread.edits).toEqual([{ appliedTags: ['l-bug', 'l-open'] }]);
    expect(thread.locked).toBe(true);
    expect(thread.log).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// audit 73 + audit 74 — /memory update-status
// ---------------------------------------------------------------------------

describe('/memory update-status (audit 73, audit 74)', () => {
  function statusSetup(itemStatus: string, threadState: { archived: boolean; locked: boolean; appliedTags: string[] }) {
    seedTwoForums('g-us');
    const item = { id: 3, guildId: 'g-us', memoryConfigId: 502, threadId: 't-us', title: 'Item', status: itemStatus };
    db.MemoryItem.push(item);
    const thread = makeThread('t-us', threadState);
    const guild = makeGuild({ fb: makeForum('fb'), 't-us': thread });
    return { item, thread, guild };
  }

  test("reopens a Completed item in the second forum, given the first forum's 'Open' id", async () => {
    const { item, thread, guild } = statusSetup('Completed', {
      archived: true,
      locked: true,
      appliedTags: ['fb-done', 'manual'],
    });
    // 512 is forum A's "Open" — what the old name-deduped autocomplete returned
    const slash = makeSlash({ guildId: 'g-us', guild, strings: { thread: 't-us', status: '512' } });
    await handlers.memoryUpdateStatusHandler(slash.i);

    expect(thread.edits).toEqual([{ appliedTags: ['manual', 'fb-open'], archived: false, locked: false }]);
    expect(item.status).toBe('Open');
    expect(slash.rec.calls.at(-1)?.[1].content).toContain(lang.memory.quickUpdate.statusSuccess);
    expect(thread.log).toEqual([]);
  });

  test('moving to Completed still locks and archives after the tag edit', async () => {
    const { thread, guild } = statusSetup('Open', { archived: false, locked: false, appliedTags: ['fb-open'] });
    const slash = makeSlash({ guildId: 'g-us', guild, strings: { thread: 't-us', status: '523' } });
    await handlers.memoryUpdateStatusHandler(slash.i);

    expect(thread.edits).toEqual([{ appliedTags: ['fb-done'] }]);
    expect(thread.log).toEqual(['locked:true', 'archived:true']);
  });

  test('a change between non-Completed statuses keeps the thread locked', async () => {
    const { item, thread, guild } = statusSetup('Open', { archived: false, locked: true, appliedTags: ['fb-open'] });
    db.MemoryTag.push(tag(524, 502, 'In Progress', 'status', 'fb-wip', 'g-us'));
    const slash = makeSlash({ guildId: 'g-us', guild, strings: { thread: 't-us', status: '524' } });
    await handlers.memoryUpdateStatusHandler(slash.i);

    expect(thread.edits).toEqual([{ appliedTags: ['fb-wip'] }]);
    expect(thread.locked).toBe(true);
    expect(item.status).toBe('In Progress');
  });

  test('an unknown status gets a status error, not "item not found"', async () => {
    const { guild } = statusSetup('Open', { archived: false, locked: false, appliedTags: [] });
    const slash = makeSlash({ guildId: 'g-us', guild, strings: { thread: 't-us', status: '99999' } });
    await handlers.memoryUpdateStatusHandler(slash.i);

    expect(slash.rec.calls[0][1].content).toContain(lang.memory.tags.edit.tagNotFound);
  });
});

// ---------------------------------------------------------------------------
// audit 73 — in-thread /memory update
// ---------------------------------------------------------------------------

describe('in-thread /memory update (audit 73)', () => {
  test('Completed to Open unarchives and unlocks in the tag edit', async () => {
    const guildId = 'g-up';
    db.MemoryConfig.push({ id: 901, guildId, forumChannelId: 'f-up', channelName: 'Memory', sortOrder: 0 });
    db.MemoryTag.push(
      tag(911, 901, 'Open', 'status', 'u-open', guildId),
      tag(912, 901, 'Completed', 'status', 'u-done', guildId),
    );
    const item = { id: 6, guildId, memoryConfigId: 901, threadId: 't-up', title: 'Old bug', status: 'Completed' };
    db.MemoryItem.push(item);
    const thread = makeThread('t-up', { archived: true, locked: true, appliedTags: ['u-done', 'manual'] });
    Object.assign(thread, { type: ChannelType.PublicThread, parentId: 'f-up', name: 'Old bug' });
    const guild = makeGuild({});

    const slash = makeSlash({ guildId, guild });
    slash.i.channel = thread;
    await handlers.memoryUpdateHandler(slash.i);
    const collector = slash.rec.collector!;

    const user = slash.i.user;
    await collector.handlers.collect(
      makeComponent(user, guild, { customId: 'memory_update_status', values: ['911'] }).c,
    );
    const confirm = makeComponent(user, guild, { customId: 'memory_update_confirm' });
    await collector.handlers.collect(confirm.c);

    expect(callNames(confirm.rec)).toEqual(['update']);
    // Unarchived + unlocked in the same edit; the hand-added tag survives
    expect(thread.edits).toEqual([{ appliedTags: ['manual', 'u-open'], archived: false, locked: false }]);
    expect(thread.log).toEqual([]); // not locked or archived again
    expect(item.status).toBe('Open');
    const last = slash.rec.calls.at(-1)!;
    expect(last[0]).toBe('editReply');
    expect(last[1].content).toContain(lang.memory.update.success);
  });
});

describe('status autocomplete (audit 74)', () => {
  async function complete(thread: string | null) {
    const responses: Array<Array<{ name: string; value: string }>> = [];
    const interaction = {
      guildId: 'g-us',
      options: {
        getFocused: () => ({ name: 'status', value: '' }),
        getString: (name: string) => (name === 'thread' ? thread : null),
      },
      respond: async (choices: Array<{ name: string; value: string }>) => {
        responses.push(choices);
      },
    };
    await handlers.memoryAutocomplete(interaction as any);
    return responses[0];
  }

  test("with the item picked, offers that item's forum statuses", async () => {
    seedTwoForums('g-us');
    db.MemoryItem.push({ id: 4, guildId: 'g-us', memoryConfigId: 502, threadId: 't-ac', title: 'B', status: 'Open' });
    expect((await complete('t-ac')).map(c => c.value)).toEqual(['522', '523']);
  });

  test('without an item, names are deduped across forums', async () => {
    seedTwoForums('g-us');
    expect((await complete(null)).map(c => c.name)).toEqual(['Open', 'Completed']);
  });
});

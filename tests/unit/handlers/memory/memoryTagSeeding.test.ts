/**
 * Memory tag seeding (v3.16.17, NindroidA/cogworks-bot#41).
 *
 * Audit findings covered:
 * - 66: /memory-setup add-channel merges the default tags into the forum's
 *   existing tags instead of replacing them (which deleted every other tag and
 *   stripped it from every post).
 * - 117: re-running the /bot-setup memory flow on the same forum changes
 *   nothing: no PATCH, no new MemoryTag rows, no second welcome thread, a
 *   default tag an admin renamed in Discord stays linked to its row, and a
 *   default renamed with the bot's tag edit doesn't come back.
 *
 * Strategy: patch AppDataSource.getRepository with in-memory fakes (same seam
 * as memoryFlows.test.ts) and drive the real handlers with minimal interaction
 * doubles. lazyRepo caches the first repo it gets, so the fakes are stable
 * objects over a mutable `db`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';

type Row = Record<string, any>;
type Table = 'MemoryConfig' | 'MemoryTag' | 'MemoryItem';

const db: Record<Table, Row[]> = { MemoryConfig: [], MemoryTag: [], MemoryItem: [] };
let nextId = 1000;

const matches = (row: Row, where: Row = {}) => Object.entries(where).every(([k, v]) => row[k] === v);

function makeRepo(table: Table) {
  return {
    find: async (opts: { where?: Row } = {}) => db[table].filter(r => matches(r, opts.where)),
    findOneBy: async (where: Row) => db[table].find(r => matches(r, where)) ?? null,
    count: async (opts: { where?: Row } = {}) => db[table].filter(r => matches(r, opts.where)).length,
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

let memorySetupHandler: typeof import('../../../../src/commands/handlers/memory/setup').memorySetupHandler;
let runSystemFlow: typeof import('../../../../src/commands/handlers/botSetup/systemFlows').runSystemFlow;
let originalGetRepository: ((entity: any) => unknown) | undefined;

beforeAll(async () => {
  const { AppDataSource } = await import('../../../../src/typeorm');
  const ds = AppDataSource as unknown as { getRepository: (e: any) => unknown };
  originalGetRepository = ds.getRepository;
  ds.getRepository = (entity: any) => fakeRepos[entity?.name] ?? benignRepo;

  memorySetupHandler = (await import('../../../../src/commands/handlers/memory/setup')).memorySetupHandler;
  runSystemFlow = (await import('../../../../src/commands/handlers/botSetup/systemFlows')).runSystemFlow;
});

afterAll(async () => {
  const { AppDataSource } = await import('../../../../src/typeorm');
  if (originalGetRepository) {
    (AppDataSource as unknown as { getRepository: (e: any) => unknown }).getRepository = originalGetRepository;
  }
  const { clearGuildCommandSignature } = await import('../../../../src/utils/setup/commandGating');
  clearGuildCommandSignature('g-bs');
});

beforeEach(() => {
  db.MemoryConfig = [];
  db.MemoryTag = [];
  db.MemoryItem = [];
});

// ---------------------------------------------------------------------------
// Discord doubles
// ---------------------------------------------------------------------------

const DEFAULTS = ['Bug', 'Feature', 'Suggestion', 'Reminder', 'Note', 'Open', 'In Progress', 'On Hold', 'Completed'];
const STATUSES = new Set(['Open', 'In Progress', 'On Hold', 'Completed']);

let userSeq = 0;

function makeForum(id: string, tags: Array<{ id: string; name: string }>) {
  let seq = 0;
  const f: any = {
    id,
    name: `forum-${id}`,
    availableTags: tags.map(t => ({ ...t, moderated: false, emoji: null })),
    patches: [] as Row[][],
    threadsCreated: 0,
    setAvailableTags: async (next: Row[]) => {
      if (next.length > 20) throw new Error('50035: too many tags');
      f.patches.push(next);
      f.availableTags = next.map(t => ({ ...t, id: t.id ?? `${id}-new-${++seq}` }));
      return f;
    },
    threads: {
      create: async () => {
        f.threadsCreated++;
        return { id: `${id}-welcome-${f.threadsCreated}`, pin: async () => {} };
      },
    },
  };
  return f;
}

const tagRow = (memoryConfigId: number, name: string, discordTagId: string | null, guildId: string) => ({
  id: nextId++,
  guildId,
  memoryConfigId,
  name,
  emoji: null,
  tagType: STATUSES.has(name) ? 'status' : 'category',
  isDefault: DEFAULTS.includes(name),
  discordTagId,
});

/** Drive /bot-setup → Memory System → "use an existing forum" → pick `forumId`. */
async function runBotSetupMemory(guildId: string, channels: Record<string, unknown>, forumId: string) {
  const guild = {
    channels: {
      fetch: async (id: string) => {
        if (!(id in channels)) throw new Error('Unknown Channel');
        return channels[id];
      },
    },
  };
  const submit = {
    guild,
    fields: { getField: (id: string) => (id === 'setup_memory_forum' ? { values: [forumId] } : null) },
    deferUpdate: async () => {},
  };
  const user = { id: `user-${++userSeq}` };
  const btn: any = {
    customId: 'setup_ch_existing',
    user,
    guild,
    replied: false,
    deferred: false,
    showModal: async () => {
      btn.replied = true;
    },
    awaitModalSubmit: async () => submit,
  };
  const menu: any = {
    customId: 'setup_system_select',
    values: ['memory'],
    user,
    guild,
    replied: false,
    deferred: false,
    update: async () => {
      menu.replied = true;
    },
    editReply: async () => {},
    followUp: async () => {},
    channel: { awaitMessageComponent: async () => btn },
  };
  return runSystemFlow('memory', menu, {} as any, guildId, { guildId, systemStates: {}, partialData: {} } as any);
}

// ---------------------------------------------------------------------------
// audit 66 — /memory-setup add-channel
// ---------------------------------------------------------------------------

describe('/memory-setup add-channel keeps the forum tags (audit 66)', () => {
  test('merges the defaults into a curated forum', async () => {
    const forum = makeForum('f-add', [
      { id: 'c1', name: 'Curated' },
      { id: 'c2', name: 'bug' },
      { id: 'c3', name: 'Shipped' },
    ]);
    const calls: string[] = [];
    const slash: any = {
      guildId: 'g-add',
      guild: { channels: { fetch: async () => forum } },
      user: { id: `user-${++userSeq}` },
      member: { permissions: { has: () => true } },
      replied: false,
      deferred: false,
      isRepliable: () => true,
      options: {
        getSubcommand: () => 'add-channel',
        getChannel: (name: string) => (name === 'channel' ? forum : null),
        getString: () => null,
      },
      reply: async () => {
        calls.push('reply');
        slash.replied = true;
      },
      deferReply: async () => {
        calls.push('deferReply');
        slash.deferred = true;
      },
      editReply: async (p: Row) => {
        calls.push(`editReply:${p.content ?? ''}`);
      },
      followUp: async () => {},
    };
    await memorySetupHandler({} as any, slash);

    expect(forum.patches).toHaveLength(1);
    const sent = forum.patches[0];
    expect(sent.slice(0, 3).map((t: Row) => t.id)).toEqual(['c1', 'c2', 'c3']);
    expect(sent).toHaveLength(11); // 3 existing + 8 defaults ("Bug" reuses "bug")

    const rows = db.MemoryTag.filter(r => r.guildId === 'g-add');
    expect(rows).toHaveLength(9);
    expect(rows.find(r => r.name === 'Bug')?.discordTagId).toBe('c2');
    expect(rows.every(r => r.discordTagId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// audit 117 — re-running the /bot-setup memory flow
// ---------------------------------------------------------------------------

describe('re-running the /bot-setup memory flow (audit 117)', () => {
  const guildId = 'g-bs';

  /** A forum already set up once: every default + a custom "Docs" tag, linked by id. */
  function seedSetUpForum(extraForumTags: Array<{ id: string; name: string }> = []) {
    const forum = makeForum('f-bs', [
      ...DEFAULTS.map(name => ({ id: `fbs-${name}`, name })),
      { id: 'fbs-Docs', name: 'Docs' },
      ...extraForumTags,
    ]);
    db.MemoryConfig.push({ id: 901, guildId, forumChannelId: 'f-bs', channelName: 'memory', messageId: 'w-1' });
    for (const name of [...DEFAULTS, 'Docs']) db.MemoryTag.push(tagRow(901, name, `fbs-${name}`, guildId));
    return forum;
  }

  test('on the same forum changes nothing', async () => {
    const forum = seedSetUpForum([{ id: 'fbs-Pinned', name: 'Pinned' }]); // "Pinned" isn't a memory tag at all
    const before = db.MemoryTag.map(r => ({ ...r }));

    const result = await runBotSetupMemory(guildId, { 'f-bs': forum }, 'f-bs');

    expect(result.updated).toBe(true);
    expect(forum.patches).toHaveLength(0); // every tag already exists: nothing sent, nothing deleted
    expect(forum.threadsCreated).toBe(0); // the existing welcome thread is kept
    expect(db.MemoryTag).toEqual(before);
    expect(db.MemoryConfig).toHaveLength(1);
  });

  test('a default tag renamed in Discord stays linked to its row', async () => {
    const forum = seedSetUpForum();
    // An admin renamed "Bug" to "Bugs" in the forum settings; the id is unchanged
    forum.availableTags.find((t: Row) => t.id === 'fbs-Bug').name = 'Bugs';

    await runBotSetupMemory(guildId, { 'f-bs': forum }, 'f-bs');

    expect(forum.patches).toHaveLength(0); // no second "Bug" tag
    expect(db.MemoryTag.find(r => r.name === 'Bug')?.discordTagId).toBe('fbs-Bug');
  });

  test('a renamed tag on a full (20-tag) forum keeps its id instead of losing it', async () => {
    const filler = Array.from({ length: 10 }, (_, i) => ({ id: `fill-${i}`, name: `Filler ${i}` }));
    const forum = seedSetUpForum(filler);
    expect(forum.availableTags).toHaveLength(20);
    forum.availableTags.find((t: Row) => t.id === 'fbs-Bug').name = 'Bugs';

    await runBotSetupMemory(guildId, { 'f-bs': forum }, 'f-bs');

    expect(forum.patches).toHaveLength(0);
    expect(db.MemoryTag.find(r => r.name === 'Bug')?.discordTagId).toBe('fbs-Bug');
  });

  test("a default renamed with the bot's tag edit doesn't come back under its old name", async () => {
    const forum = seedSetUpForum();
    // /memory tags action:edit (or /memory-setup tag-edit) renamed "Bug" to "Defect" in both places
    db.MemoryTag.find(r => r.name === 'Bug')!.name = 'Defect';
    forum.availableTags.find((t: Row) => t.id === 'fbs-Bug').name = 'Defect';
    const before = db.MemoryTag.map(r => ({ ...r }));

    await runBotSetupMemory(guildId, { 'f-bs': forum }, 'f-bs');

    expect(forum.patches).toHaveLength(0); // no new "Bug" tag
    expect(forum.availableTags.map((t: Row) => t.name)).not.toContain('Bug');
    expect(db.MemoryTag).toEqual(before);
  });

  test('a config with only custom rows still gets the defaults', async () => {
    // Its first seeding failed before any default row was saved; a custom tag was added later
    const forum = makeForum('f-bs', [{ id: 'fbs-Docs', name: 'Docs' }]);
    db.MemoryConfig.push({ id: 901, guildId, forumChannelId: 'f-bs', channelName: 'memory', messageId: 'w-1' });
    db.MemoryTag.push(tagRow(901, 'Docs', 'fbs-Docs', guildId));

    await runBotSetupMemory(guildId, { 'f-bs': forum }, 'f-bs');

    expect(forum.patches).toHaveLength(1);
    expect(forum.availableTags.map((t: Row) => t.name)).toEqual(['Docs', ...DEFAULTS]);
    expect(db.MemoryTag.filter(r => r.memoryConfigId === 901)).toHaveLength(10);
    expect(db.MemoryTag.find(r => r.name === 'Docs')?.discordTagId).toBe('fbs-Docs');
  });

  test('a row whose forum tag was deleted is re-linked by name or re-added', async () => {
    const forum = seedSetUpForum();
    // "Note" was deleted from the forum, and "Docs" was deleted and re-created by hand
    forum.availableTags = forum.availableTags.filter((t: Row) => t.id !== 'fbs-Note' && t.id !== 'fbs-Docs');
    forum.availableTags.push({ id: 'docs-2', name: 'docs', moderated: false, emoji: null });

    await runBotSetupMemory(guildId, { 'f-bs': forum }, 'f-bs');

    expect(forum.patches).toHaveLength(1);
    expect(forum.patches[0].map((t: Row) => t.name)).toContain('Note');
    expect(db.MemoryTag.find(r => r.name === 'Note')?.discordTagId).toBe('f-bs-new-1');
    expect(db.MemoryTag.find(r => r.name === 'Docs')?.discordTagId).toBe('docs-2');
    expect(db.MemoryTag.filter(r => r.memoryConfigId === 901)).toHaveLength(10);
  });

  test('duplicate rows left by an earlier version are not multiplied', async () => {
    const forum = seedSetUpForum();
    // What a pre-3.16.17 re-run left behind: a second, stale copy of each default
    for (const name of DEFAULTS) db.MemoryTag.push(tagRow(901, name, `stale-${name}`, guildId));
    const count = db.MemoryTag.length;

    await runBotSetupMemory(guildId, { 'f-bs': forum }, 'f-bs');

    expect(db.MemoryTag).toHaveLength(count);
    expect(forum.availableTags).toHaveLength(DEFAULTS.length + 1); // no tag deleted or duplicated
  });

  test('moving the config to another forum links its rows there and posts a welcome thread', async () => {
    const oldForum = seedSetUpForum();
    const newForum = makeForum('f-new', [
      { id: 'n-open', name: 'Open' },
      { id: 'n-mine', name: 'Mine' },
    ]);

    await runBotSetupMemory(guildId, { 'f-bs': oldForum, 'f-new': newForum }, 'f-new');

    expect(db.MemoryConfig[0].forumChannelId).toBe('f-new');
    expect(newForum.patches).toHaveLength(1);
    const names = newForum.availableTags.map((t: Row) => t.name);
    expect(names.slice(0, 2)).toEqual(['Open', 'Mine']); // the forum's own tags stay first, with their ids
    expect(names).toContain('Docs');
    expect(db.MemoryTag.find(r => r.name === 'Open')?.discordTagId).toBe('n-open');
    expect(db.MemoryTag.find(r => r.name === 'Docs')?.discordTagId).toMatch(/^f-new-new-/);
    expect(db.MemoryTag).toHaveLength(10);
    expect(newForum.threadsCreated).toBe(1);
  });
});

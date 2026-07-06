/**
 * channelDelete Event Handler Unit Tests
 *
 * Verifies the v3.1.32 descriptor pattern works as intended:
 *  - All 13 entity-cleanup descriptors run for a single channel-delete event
 *  - Promise.allSettled semantics — one cleaner failing must not abort siblings
 *  - Failure attribution uses the descriptor's `name` field (no parallel array)
 *  - Per-entity mutation logic: nullify only the matching column(s)
 *
 * Strategy: patch AppDataSource.getRepository to dispatch by entity name to a
 * registry of per-entity fake repos. lazyRepo's Proxy resolves on first
 * property access, so this works without touching production code.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from 'bun:test';

// Each entity has its own fake repo. The handler does
// `AppDataSource.getRepository(EntityClass).findOneBy(...)` etc., so we map
// by entity NAME (function constructor name) and return the matching fake.
interface FakeRepoState {
  rows: Map<string, any>;
  findOneByCalls: any[];
  findCalls: any[];
  saveCalls: any[];
  removeCalls: any[];
  countCalls: any[];
  shouldThrowOn?: 'findOneBy' | 'find' | 'save' | 'remove' | 'count';
}

function makeFakeRepo(initialRows: any[] = []): FakeRepoState & {
  findOneBy: (where: any) => Promise<any>;
  find: (opts: any) => Promise<any[]>;
  save: (entity: any) => Promise<any>;
  remove: (entity: any) => Promise<any>;
  count: (opts: any) => Promise<number>;
} {
  const state: FakeRepoState = {
    rows: new Map(initialRows.map((r, i) => [String(r.id ?? i), r])),
    findOneByCalls: [],
    findCalls: [],
    saveCalls: [],
    removeCalls: [],
    countCalls: [],
  };
  return {
    ...state,
    async findOneBy(where: any) {
      state.findOneByCalls.push(where);
      if (state.shouldThrowOn === 'findOneBy') throw new Error('boom-findOneBy');
      // Match the first row whose fields all equal the where clause
      for (const row of state.rows.values()) {
        if (Object.entries(where).every(([k, v]) => (row as any)[k] === v)) return row;
      }
      return null;
    },
    async find(opts: any) {
      state.findCalls.push(opts);
      if (state.shouldThrowOn === 'find') throw new Error('boom-find');
      const where = opts?.where ?? {};
      return [...state.rows.values()].filter(row => Object.entries(where).every(([k, v]) => (row as any)[k] === v));
    },
    async save(entity: any) {
      state.saveCalls.push({ ...entity });
      if (state.shouldThrowOn === 'save') throw new Error('boom-save');
      state.rows.set(String(entity.id ?? state.rows.size), entity);
      return entity;
    },
    async remove(entity: any) {
      state.removeCalls.push(Array.isArray(entity) ? [...entity] : { ...entity });
      if (state.shouldThrowOn === 'remove') throw new Error('boom-remove');
      const targets = Array.isArray(entity) ? entity : [entity];
      for (const t of targets) state.rows.delete(String(t.id));
      return entity;
    },
    async count(opts: any) {
      state.countCalls.push(opts);
      if (state.shouldThrowOn === 'count') throw new Error('boom-count');
      const where = opts?.where ?? {};
      return [...state.rows.values()].filter(row => Object.entries(where).every(([k, v]) => (row as any)[k] === v))
        .length;
    },
  } as any;
}

// Registry of per-entity fakes. Keys are TypeORM entity class names.
const fakeRepos: Record<string, ReturnType<typeof makeFakeRepo>> = {};

function resetFakeRepos() {
  for (const key of Object.keys(fakeRepos)) delete fakeRepos[key];
  // Pre-create a fake for every entity the handler touches so descriptor
  // lookups don't crash with "no fake registered".
  for (const name of [
    'TicketConfig',
    'ArchivedTicketConfig',
    'ApplicationConfig',
    'ArchivedApplicationConfig',
    'BaitChannelConfig',
    'RulesConfig',
    'ReactionRoleMenu',
    'MemoryConfig',
    'AnnouncementConfig',
    'StarboardConfig',
    'XPConfig',
    'EventConfig',
    'AnalyticsConfig',
  ]) {
    fakeRepos[name] = makeFakeRepo();
  }
}

// Capture invalidate calls so we can verify the handler triggers cache flushes.
const fakeInvalidateRulesCache = jest.fn();
const fakeInvalidateGuildMenuCache = jest.fn();
const fakeInvalidateStarboardCache = jest.fn();

(globalThis as any).mock?.module?.('../../../src/utils/rules/rulesCache', () => ({
  invalidateRulesCache: fakeInvalidateRulesCache,
}));

import { mock } from 'bun:test';

mock.module('../../../src/utils/rules/rulesCache', () => ({
  invalidateRulesCache: fakeInvalidateRulesCache,
}));
mock.module('../../../src/utils/reactionRole/menuCache', () => ({
  invalidateGuildMenuCache: fakeInvalidateGuildMenuCache,
  invalidateMenuCache: jest.fn(),
  getCachedMenu: jest.fn(),
  getOptionByEmoji: jest.fn(),
}));
mock.module('../../../src/events/starboardReaction', () => ({
  invalidateStarboardCache: fakeInvalidateStarboardCache,
}));

let channelDeleteHandler: typeof import('../../../src/events/channelDelete').default;
let originalGetRepository: ((entity: any) => unknown) | undefined;

beforeAll(async () => {
  const { AppDataSource } = await import('../../../src/typeorm');
  // Capture the original so afterAll can put it back. Bun runs test files in
  // a single process; leaving the patch installed leaks into every file that
  // runs after this one.
  originalGetRepository = (AppDataSource as unknown as { getRepository: (e: any) => unknown }).getRepository;
  (AppDataSource as unknown as { getRepository: (e: any) => unknown }).getRepository = (entity: any) => {
    const name = entity?.name ?? 'unknown';
    if (!fakeRepos[name]) {
      throw new Error(`channelDelete test: no fake repo registered for entity "${name}"`);
    }
    return fakeRepos[name];
  };
  channelDeleteHandler = (await import('../../../src/events/channelDelete')).default;
});

afterAll(async () => {
  if (originalGetRepository) {
    const { AppDataSource } = await import('../../../src/typeorm');
    (AppDataSource as unknown as { getRepository: (e: any) => unknown }).getRepository = originalGetRepository;
  }
});

// ---------------------------------------------------------------------------
// Fake Discord client + channel
// ---------------------------------------------------------------------------

function makeFakeChannel(channelId: string, guildId: string) {
  return {
    id: channelId,
    guild: { id: guildId },
  } as any;
}

const mockClient = {
  baitChannelManager: { clearConfigCache: jest.fn() },
} as any;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('channelDelete event handler', () => {
  beforeEach(() => {
    resetFakeRepos();
    fakeInvalidateRulesCache.mockClear();
    fakeInvalidateGuildMenuCache.mockClear();
    fakeInvalidateStarboardCache.mockClear();
    mockClient.baitChannelManager.clearConfigCache.mockClear();
  });

  test('returns early on DM channel (no `guild` property)', async () => {
    const dmChannel = { id: 'dm-1' } as any; // no guild property
    await channelDeleteHandler.execute(dmChannel, mockClient);
    // No repo accessed because we returned before the descriptor sweep
    for (const repo of Object.values(fakeRepos)) {
      expect(repo.findOneByCalls.length).toBe(0);
    }
  });

  test('descriptor sweep: every entity is queried at least once', async () => {
    const channel = makeFakeChannel('chan-1', 'guild-1');
    await channelDeleteHandler.execute(channel, mockClient);

    // Each entity-config fake repo should have been queried (findOneBy or find)
    const queriedEntities = Object.entries(fakeRepos)
      .filter(([_, repo]) => repo.findOneByCalls.length > 0 || repo.findCalls.length > 0)
      .map(([name]) => name)
      .sort();

    // The handler MUST hit all 13 entities (failure attribution would otherwise
    // skip a system silently). This is the regression test for the descriptor
    // pattern: removing a descriptor entry would fail this list.
    expect(queriedEntities).toEqual(
      [
        'AnalyticsConfig',
        'AnnouncementConfig',
        'ApplicationConfig',
        'ArchivedApplicationConfig',
        'ArchivedTicketConfig',
        'BaitChannelConfig',
        'EventConfig',
        'MemoryConfig',
        'ReactionRoleMenu',
        'RulesConfig',
        'StarboardConfig',
        'TicketConfig',
        'XPConfig',
      ].sort(),
    );
  });

  test('TicketConfig: nullifies channelId/messageId when channel matches', async () => {
    const channel = makeFakeChannel('chan-X', 'guild-1');
    fakeRepos.TicketConfig.rows.set('1', {
      id: 1,
      guildId: 'guild-1',
      channelId: 'chan-X',
      messageId: 'msg-1',
      categoryId: null,
      slaBreachChannelId: null,
    });

    await channelDeleteHandler.execute(channel, mockClient);

    expect(fakeRepos.TicketConfig.saveCalls.length).toBe(1);
    const saved = fakeRepos.TicketConfig.saveCalls[0];
    expect(saved.channelId).toBe('');
    expect(saved.messageId).toBe('');
  });

  test('TicketConfig: nullifies categoryId when category matches', async () => {
    const channel = makeFakeChannel('cat-Y', 'guild-1');
    fakeRepos.TicketConfig.rows.set('1', {
      id: 1,
      guildId: 'guild-1',
      channelId: 'unrelated',
      messageId: 'unrelated',
      categoryId: 'cat-Y',
      slaBreachChannelId: null,
    });

    await channelDeleteHandler.execute(channel, mockClient);

    expect(fakeRepos.TicketConfig.saveCalls.length).toBe(1);
    expect(fakeRepos.TicketConfig.saveCalls[0].categoryId).toBe(null);
    expect(fakeRepos.TicketConfig.saveCalls[0].channelId).toBe('unrelated');
  });

  test('TicketConfig: skips save when no field matches', async () => {
    const channel = makeFakeChannel('chan-other', 'guild-1');
    fakeRepos.TicketConfig.rows.set('1', {
      id: 1,
      guildId: 'guild-1',
      channelId: 'unrelated',
      messageId: 'msg',
      categoryId: 'cat',
      slaBreachChannelId: null,
    });

    await channelDeleteHandler.execute(channel, mockClient);

    expect(fakeRepos.TicketConfig.saveCalls.length).toBe(0);
  });

  test('Promise.allSettled: one cleaner throwing does not abort siblings', async () => {
    const channel = makeFakeChannel('chan-1', 'guild-1');
    // Make BaitChannelConfig's findOneBy throw — other cleaners must still run
    fakeRepos.BaitChannelConfig.shouldThrowOn = 'findOneBy';
    fakeRepos.TicketConfig.rows.set('1', {
      id: 1,
      guildId: 'guild-1',
      channelId: 'chan-1',
      messageId: 'msg',
      categoryId: null,
      slaBreachChannelId: null,
    });

    await channelDeleteHandler.execute(channel, mockClient);

    // TicketConfig still got cleaned despite BaitChannelConfig throwing
    expect(fakeRepos.TicketConfig.saveCalls.length).toBe(1);
    expect(fakeRepos.TicketConfig.saveCalls[0].channelId).toBe('');
  });

  test('RulesConfig: deletes matching record and invalidates cache', async () => {
    const channel = makeFakeChannel('rules-chan', 'guild-1');
    fakeRepos.RulesConfig.rows.set('1', {
      id: 1,
      guildId: 'guild-1',
      channelId: 'rules-chan',
      messageId: 'rules-msg',
      roleId: 'role-1',
    });

    await channelDeleteHandler.execute(channel, mockClient);

    expect(fakeRepos.RulesConfig.removeCalls.length).toBe(1);
    expect(fakeInvalidateRulesCache).toHaveBeenCalledWith('guild-1');
  });

  test('ReactionRoleMenu: deletes all matching menus and invalidates guild menu cache', async () => {
    const channel = makeFakeChannel('rr-chan', 'guild-1');
    fakeRepos.ReactionRoleMenu.rows.set('1', {
      id: 1,
      guildId: 'guild-1',
      channelId: 'rr-chan',
      name: 'menu-one',
    });
    fakeRepos.ReactionRoleMenu.rows.set('2', {
      id: 2,
      guildId: 'guild-1',
      channelId: 'rr-chan',
      name: 'menu-two',
    });

    await channelDeleteHandler.execute(channel, mockClient);

    expect(fakeRepos.ReactionRoleMenu.removeCalls.length).toBe(1);
    // Single remove() call gets both rows as an array
    const removed = fakeRepos.ReactionRoleMenu.removeCalls[0];
    expect(Array.isArray(removed)).toBe(true);
    expect(removed.length).toBe(2);
    expect(fakeInvalidateGuildMenuCache).toHaveBeenCalledWith('guild-1');
  });

  test('BaitChannelConfig: clears manager cache when bait channel matches', async () => {
    const channel = makeFakeChannel('bait-chan', 'guild-1');
    fakeRepos.BaitChannelConfig.rows.set('1', {
      id: 1,
      guildId: 'guild-1',
      channelId: 'bait-chan',
      channelMessageId: 'msg',
      channelIds: null,
      logChannelId: null,
      summaryChannelId: null,
      enabled: true,
    });

    await channelDeleteHandler.execute(channel, mockClient);

    expect(fakeRepos.BaitChannelConfig.saveCalls.length).toBe(1);
    expect(fakeRepos.BaitChannelConfig.saveCalls[0].enabled).toBe(false);
    expect(fakeRepos.BaitChannelConfig.saveCalls[0].channelId).toBe('');
    expect(mockClient.baitChannelManager.clearConfigCache).toHaveBeenCalledWith('guild-1');
  });

  test('BaitChannelConfig: deleting the PRIMARY of several bait channels keeps detection enabled', async () => {
    const channel = makeFakeChannel('bait-1', 'guild-1');
    fakeRepos.BaitChannelConfig.rows.set('1', {
      id: 1,
      guildId: 'guild-1',
      channelId: 'bait-1',
      channelMessageId: 'warn-msg',
      channelIds: ['bait-1', 'bait-2'],
      logChannelId: null,
      summaryChannelId: null,
      enabled: true,
    });

    await channelDeleteHandler.execute(channel, mockClient);

    expect(fakeRepos.BaitChannelConfig.saveCalls.length).toBe(1);
    const saved = fakeRepos.BaitChannelConfig.saveCalls[0];
    expect(saved.enabled).toBe(true); // survivors keep working
    expect(saved.channelIds).toEqual(['bait-2']);
    expect(saved.channelId).toBe('bait-2'); // legacy column re-pointed at new primary
    expect(saved.channelMessageId).toBe(null); // warning message died with the channel
  });

  test('BaitChannelConfig: deleting a NON-primary bait channel keeps primary and warning message', async () => {
    const channel = makeFakeChannel('bait-2', 'guild-1');
    fakeRepos.BaitChannelConfig.rows.set('1', {
      id: 1,
      guildId: 'guild-1',
      channelId: 'bait-1',
      channelMessageId: 'warn-msg',
      channelIds: ['bait-1', 'bait-2'],
      logChannelId: null,
      summaryChannelId: null,
      enabled: true,
    });

    await channelDeleteHandler.execute(channel, mockClient);

    expect(fakeRepos.BaitChannelConfig.saveCalls.length).toBe(1);
    const saved = fakeRepos.BaitChannelConfig.saveCalls[0];
    expect(saved.enabled).toBe(true);
    expect(saved.channelIds).toEqual(['bait-1']);
    expect(saved.channelId).toBe('bait-1');
    expect(saved.channelMessageId).toBe('warn-msg');
  });

  test('BaitChannelConfig divergent row: deleting the stale channelIds entry falls back to the legacy channel', async () => {
    // Pre-v3.15.3 dual-write bug signature: legacy channelId=B (admin's last
    // explicit choice, banner lives there), channelIds=[A] stale. Deleting A
    // must fall back to B — not wipe it and disable the system.
    const channel = makeFakeChannel('stale-A', 'guild-1');
    fakeRepos.BaitChannelConfig.rows.set('1', {
      id: 1,
      guildId: 'guild-1',
      channelId: 'chan-B',
      channelMessageId: 'banner-msg',
      channelIds: ['stale-A'],
      logChannelId: null,
      summaryChannelId: null,
      enabled: true,
    });

    await channelDeleteHandler.execute(channel, mockClient);

    expect(fakeRepos.BaitChannelConfig.saveCalls.length).toBe(1);
    const saved = fakeRepos.BaitChannelConfig.saveCalls[0];
    expect(saved.enabled).toBe(true);
    expect(saved.channelId).toBe('chan-B');
    expect(saved.channelIds).toEqual(['chan-B']); // divergence repaired
    expect(saved.channelMessageId).toBe('banner-msg'); // banner in B untouched
  });

  test('BaitChannelConfig divergent row: deleting the legacy channel keeps detection on the channelIds entry', async () => {
    const channel = makeFakeChannel('chan-B', 'guild-1');
    fakeRepos.BaitChannelConfig.rows.set('1', {
      id: 1,
      guildId: 'guild-1',
      channelId: 'chan-B',
      channelMessageId: 'banner-msg',
      channelIds: ['live-A'],
      logChannelId: null,
      summaryChannelId: null,
      enabled: true,
    });

    await channelDeleteHandler.execute(channel, mockClient);

    expect(fakeRepos.BaitChannelConfig.saveCalls.length).toBe(1);
    const saved = fakeRepos.BaitChannelConfig.saveCalls[0];
    expect(saved.enabled).toBe(true);
    expect(saved.channelId).toBe('live-A');
    expect(saved.channelIds).toEqual(['live-A']);
    expect(saved.channelMessageId).toBe(null); // banner died with chan-B
  });

  test('BaitChannelConfig: deleting the LAST bait channel disables the system', async () => {
    const channel = makeFakeChannel('bait-only', 'guild-1');
    fakeRepos.BaitChannelConfig.rows.set('1', {
      id: 1,
      guildId: 'guild-1',
      channelId: 'bait-only',
      channelMessageId: 'warn-msg',
      channelIds: ['bait-only'],
      logChannelId: null,
      summaryChannelId: null,
      enabled: true,
    });

    await channelDeleteHandler.execute(channel, mockClient);

    expect(fakeRepos.BaitChannelConfig.saveCalls.length).toBe(1);
    const saved = fakeRepos.BaitChannelConfig.saveCalls[0];
    expect(saved.enabled).toBe(false);
    expect(saved.channelIds).toBe(null); // normalized, not []
    expect(saved.channelId).toBe('');
    expect(saved.channelMessageId).toBe(null);
  });

  test('XPConfig: removes channel from ignoredChannels array', async () => {
    const channel = makeFakeChannel('chan-skip', 'guild-1');
    fakeRepos.XPConfig.rows.set('1', {
      id: 1,
      guildId: 'guild-1',
      levelUpChannelId: null,
      ignoredChannels: ['chan-skip', 'chan-keep'],
      multiplierChannels: null,
    });

    await channelDeleteHandler.execute(channel, mockClient);

    expect(fakeRepos.XPConfig.saveCalls.length).toBe(1);
    expect(fakeRepos.XPConfig.saveCalls[0].ignoredChannels).toEqual(['chan-keep']);
  });
});

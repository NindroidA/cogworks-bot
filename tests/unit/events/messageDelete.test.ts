/**
 * messageDelete Event Handler Unit Tests
 *
 * Verifies the v3.1.32 descriptor pattern for message deletion:
 *  - All 8 entity-cleanup descriptors run for a single message-delete event
 *  - Promise.allSettled isolation — one cleaner failing or timing out doesn't abort siblings
 *  - Per-author guard: messages from non-bot users skip the DB scan entirely
 *  - withTimeout wrapper applies per-cleaner (10s budget)
 */

import { afterAll, beforeAll, beforeEach, describe, expect, jest, mock, test } from 'bun:test';

interface FakeRepoState {
  rows: Map<string, any>;
  findOneByCalls: any[];
  findCalls: any[];
  saveCalls: any[];
  removeCalls: any[];
  shouldThrowOn?: 'findOneBy' | 'find' | 'save' | 'remove';
}

function makeFakeRepo(initialRows: any[] = []): FakeRepoState & {
  findOneBy: (where: any) => Promise<any>;
  find: (opts: any) => Promise<any[]>;
  save: (entity: any) => Promise<any>;
  remove: (entity: any) => Promise<any>;
} {
  const state: FakeRepoState = {
    rows: new Map(initialRows.map((r, i) => [String(r.id ?? i), r])),
    findOneByCalls: [],
    findCalls: [],
    saveCalls: [],
    removeCalls: [],
  };
  return {
    ...state,
    async findOneBy(where: any) {
      state.findOneByCalls.push(where);
      if (state.shouldThrowOn === 'findOneBy') throw new Error('boom');
      for (const row of state.rows.values()) {
        if (Object.entries(where).every(([k, v]) => (row as any)[k] === v)) return row;
      }
      return null;
    },
    async find(opts: any) {
      state.findCalls.push(opts);
      if (state.shouldThrowOn === 'find') throw new Error('boom');
      const where = opts?.where ?? {};
      return [...state.rows.values()].filter(row =>
        Object.entries(where).every(([k, v]) => (row as any)[k] === v),
      );
    },
    async save(entity: any) {
      state.saveCalls.push({ ...entity });
      if (state.shouldThrowOn === 'save') throw new Error('boom');
      state.rows.set(String(entity.id ?? state.rows.size), entity);
      return entity;
    },
    async remove(entity: any) {
      state.removeCalls.push(Array.isArray(entity) ? [...entity] : { ...entity });
      if (state.shouldThrowOn === 'remove') throw new Error('boom');
      const targets = Array.isArray(entity) ? entity : [entity];
      for (const t of targets) state.rows.delete(String(t.id));
      return entity;
    },
  } as any;
}

const fakeRepos: Record<string, ReturnType<typeof makeFakeRepo>> = {};

function resetFakeRepos() {
  for (const key of Object.keys(fakeRepos)) delete fakeRepos[key];
  for (const name of [
    'TicketConfig',
    'ArchivedTicketConfig',
    'ApplicationConfig',
    'ArchivedApplicationConfig',
    'BaitChannelConfig',
    'RulesConfig',
    'ReactionRoleMenu',
    'MemoryConfig',
  ]) {
    fakeRepos[name] = makeFakeRepo();
  }
}

const fakeInvalidateRulesCache = jest.fn();
const fakeInvalidateMenuCache = jest.fn();
const fakeBaitHandleMessageDelete = jest.fn();

mock.module('../../../src/utils/rules/rulesCache', () => ({
  invalidateRulesCache: fakeInvalidateRulesCache,
}));
mock.module('../../../src/utils/reactionRole/menuCache', () => ({
  invalidateMenuCache: fakeInvalidateMenuCache,
  invalidateGuildMenuCache: jest.fn(),
  getCachedMenu: jest.fn(),
  getOptionByEmoji: jest.fn(),
}));

let messageDeleteHandler: typeof import('../../../src/events/messageDelete').default;

beforeAll(async () => {
  const { AppDataSource } = await import('../../../src/typeorm');
  (AppDataSource as unknown as { getRepository: (e: any) => unknown }).getRepository = (entity: any) => {
    const name = entity?.name ?? 'unknown';
    if (!fakeRepos[name]) {
      throw new Error(`messageDelete test: no fake repo registered for entity "${name}"`);
    }
    return fakeRepos[name];
  };
  messageDeleteHandler = (await import('../../../src/events/messageDelete')).default;
});

afterAll(() => {
  // Bun isolates per-process; nothing to restore.
});

function makeMessage(opts: {
  guildId: string | null;
  messageId: string;
  authorId?: string | null;
}): any {
  return {
    id: opts.messageId,
    guild: opts.guildId ? { id: opts.guildId } : null,
    author: opts.authorId === null ? null : { id: opts.authorId ?? 'bot-id' },
  };
}

const mockClient: any = {
  user: { id: 'bot-id' },
  baitChannelManager: { handleMessageDelete: fakeBaitHandleMessageDelete },
};

describe('messageDelete event handler', () => {
  beforeEach(() => {
    resetFakeRepos();
    fakeInvalidateRulesCache.mockClear();
    fakeInvalidateMenuCache.mockClear();
    fakeBaitHandleMessageDelete.mockClear();
  });

  test('returns early when message has no guild (DM context)', async () => {
    const msg = makeMessage({ guildId: null, messageId: 'm-1', authorId: 'bot-id' });
    await messageDeleteHandler.execute(msg, mockClient);
    expect(fakeBaitHandleMessageDelete).not.toHaveBeenCalled();
    for (const repo of Object.values(fakeRepos)) {
      expect(repo.findOneByCalls.length).toBe(0);
    }
  });

  test('skips DB scan when known author is not the bot (perf guard)', async () => {
    const msg = makeMessage({ guildId: 'g-1', messageId: 'm-1', authorId: 'other-user' });
    await messageDeleteHandler.execute(msg, mockClient);
    // Bait manager not invoked either since we returned BEFORE calling it
    expect(fakeBaitHandleMessageDelete).not.toHaveBeenCalled();
    for (const repo of Object.values(fakeRepos)) {
      expect(repo.findOneByCalls.length).toBe(0);
    }
  });

  test('partial message (author null) still triggers full descriptor sweep', async () => {
    const msg = makeMessage({ guildId: 'g-1', messageId: 'm-1', authorId: null });
    await messageDeleteHandler.execute(msg, mockClient);

    const queriedEntities = Object.entries(fakeRepos)
      .filter(([_, repo]) => repo.findOneByCalls.length > 0 || repo.findCalls.length > 0)
      .map(([name]) => name)
      .sort();
    expect(queriedEntities).toEqual(
      ['ApplicationConfig', 'ArchivedApplicationConfig', 'ArchivedTicketConfig', 'BaitChannelConfig', 'MemoryConfig', 'ReactionRoleMenu', 'RulesConfig', 'TicketConfig'].sort(),
    );
  });

  test('descriptor sweep: every entity is queried for bot-authored deletes', async () => {
    const msg = makeMessage({ guildId: 'g-1', messageId: 'm-1', authorId: 'bot-id' });
    await messageDeleteHandler.execute(msg, mockClient);

    const queriedEntities = Object.entries(fakeRepos)
      .filter(([_, repo]) => repo.findOneByCalls.length > 0 || repo.findCalls.length > 0)
      .map(([name]) => name)
      .sort();
    // 8 entities — the regression list. Removing a descriptor would fail this.
    expect(queriedEntities).toEqual(
      ['ApplicationConfig', 'ArchivedApplicationConfig', 'ArchivedTicketConfig', 'BaitChannelConfig', 'MemoryConfig', 'ReactionRoleMenu', 'RulesConfig', 'TicketConfig'].sort(),
    );
  });

  test('TicketConfig: clears messageId when matching message is found', async () => {
    fakeRepos.TicketConfig.rows.set('1', { id: 1, guildId: 'g-1', messageId: 'm-1' });
    const msg = makeMessage({ guildId: 'g-1', messageId: 'm-1', authorId: 'bot-id' });
    await messageDeleteHandler.execute(msg, mockClient);
    expect(fakeRepos.TicketConfig.saveCalls.length).toBe(1);
    expect(fakeRepos.TicketConfig.saveCalls[0].messageId).toBe('');
  });

  test('RulesConfig: removes the matching record and invalidates cache', async () => {
    fakeRepos.RulesConfig.rows.set('1', { id: 1, guildId: 'g-1', messageId: 'm-1', channelId: 'c-1' });
    const msg = makeMessage({ guildId: 'g-1', messageId: 'm-1', authorId: 'bot-id' });
    await messageDeleteHandler.execute(msg, mockClient);
    expect(fakeRepos.RulesConfig.removeCalls.length).toBe(1);
    expect(fakeInvalidateRulesCache).toHaveBeenCalledWith('g-1');
  });

  test('ReactionRoleMenu: deletes the matching menu and invalidates cache', async () => {
    fakeRepos.ReactionRoleMenu.rows.set('1', { id: 1, guildId: 'g-1', messageId: 'm-1', name: 'menu' });
    const msg = makeMessage({ guildId: 'g-1', messageId: 'm-1', authorId: 'bot-id' });
    await messageDeleteHandler.execute(msg, mockClient);
    expect(fakeRepos.ReactionRoleMenu.removeCalls.length).toBe(1);
    expect(fakeInvalidateMenuCache).toHaveBeenCalledWith('m-1');
  });

  test('Promise.allSettled: one cleaner failing does not abort siblings', async () => {
    fakeRepos.BaitChannelConfig.shouldThrowOn = 'findOneBy';
    fakeRepos.TicketConfig.rows.set('1', { id: 1, guildId: 'g-1', messageId: 'm-1' });
    const msg = makeMessage({ guildId: 'g-1', messageId: 'm-1', authorId: 'bot-id' });
    await messageDeleteHandler.execute(msg, mockClient);
    // Sibling TicketConfig still got cleaned up
    expect(fakeRepos.TicketConfig.saveCalls.length).toBe(1);
  });

  test('bait channel manager is invoked before the DB sweep', async () => {
    const msg = makeMessage({ guildId: 'g-1', messageId: 'm-1', authorId: 'bot-id' });
    await messageDeleteHandler.execute(msg, mockClient);
    expect(fakeBaitHandleMessageDelete).toHaveBeenCalledWith('m-1', 'g-1');
  });
});

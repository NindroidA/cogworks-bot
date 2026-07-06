/**
 * /baitchannel setup Handler Unit Tests (v3.15.3 regression)
 *
 * THE live bug: setup wrote only the legacy `channelId` column while
 * detection reads `channelIds` — once the startup backfill had populated
 * `channelIds`, changing the bait channel via setup had no effect on
 * detection. These tests pin the dual-write on both the create and update
 * paths, including the divergent-row repair case.
 *
 * Strategy: patch AppDataSource.getRepository (same seam as
 * channelDelete.test.ts) and drive the handler with a fake interaction.
 * The warning-message block is skipped because the fake channel is not an
 * `instanceof TextChannel`; keyword seeding is short-circuited by a
 * BaitKeyword fake whose count() > 0.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from 'bun:test';

interface FakeConfigRepo {
  row: any;
  findOneCalls: any[];
  createCalls: any[];
  saveCalls: any[];
  findOne: (opts: any) => Promise<any>;
  create: (obj: any) => any;
  save: (entity: any) => Promise<any>;
}

function makeFakeConfigRepo(row: any = null): FakeConfigRepo {
  const repo: FakeConfigRepo = {
    row,
    findOneCalls: [],
    createCalls: [],
    saveCalls: [],
    async findOne(opts: any) {
      repo.findOneCalls.push(opts);
      return repo.row;
    },
    create(obj: any) {
      repo.createCalls.push({ ...obj });
      return obj;
    },
    async save(entity: any) {
      repo.saveCalls.push({ ...entity });
      repo.row = entity;
      return entity;
    },
  };
  return repo;
}

// Benign catch-all for entities the handler touches indirectly (BaitKeyword
// seeding): count() > 0 makes seedDefaultKeywords return without inserting.
const benignRepo = {
  count: async () => 1,
  find: async () => [],
  findOne: async () => null,
  findOneBy: async () => null,
  save: async (e: any) => e,
  create: (e: any) => e,
} as any;

let configRepo: FakeConfigRepo;
let setupHandler: typeof import('../../../../src/commands/handlers/baitChannel/setup').setupHandler;
let originalGetRepository: ((entity: any) => unknown) | undefined;

beforeAll(async () => {
  const { AppDataSource } = await import('../../../../src/typeorm');
  originalGetRepository = (AppDataSource as unknown as { getRepository: (e: any) => unknown }).getRepository;
  (AppDataSource as unknown as { getRepository: (e: any) => unknown }).getRepository = (entity: any) =>
    entity?.name === 'BaitChannelConfig' ? configRepo : benignRepo;
  setupHandler = (await import('../../../../src/commands/handlers/baitChannel/setup')).setupHandler;
});

afterAll(async () => {
  if (originalGetRepository) {
    const { AppDataSource } = await import('../../../../src/typeorm');
    (AppDataSource as unknown as { getRepository: (e: any) => unknown }).getRepository = originalGetRepository;
  }
});

const clearConfigCache = jest.fn();
const mockClient = { baitChannelManager: { clearConfigCache } } as any;

function makeInteraction(channelId: string) {
  return {
    guildId: 'guild-1',
    guild: {
      channels: {
        // Update path may fetch the old primary to delete the warning message;
        // "channel gone" is an accepted outcome there.
        fetch: jest.fn(async () => {
          throw new Error('channel gone');
        }),
      },
    },
    options: {
      getChannel: (name: string) => (name === 'channel' ? { id: channelId, isTextBased: () => true } : null),
      getInteger: () => 20,
      getString: () => 'ban',
    },
    reply: jest.fn(async () => {}),
    replied: false,
    deferred: false,
  } as any;
}

describe('/baitchannel setup dual-write (v3.15.3)', () => {
  beforeEach(() => {
    clearConfigCache.mockClear();
  });

  test('create path: writes BOTH channelIds and legacy channelId', async () => {
    configRepo = makeFakeConfigRepo(null);
    const interaction = makeInteraction('new-chan');

    await setupHandler(mockClient, interaction);

    expect(configRepo.saveCalls.length).toBe(1);
    const saved = configRepo.saveCalls[0];
    expect(saved.channelIds).toEqual(['new-chan']);
    expect(saved.channelId).toBe('new-chan');
    expect(interaction.reply).toHaveBeenCalledTimes(1);
    expect(clearConfigCache).toHaveBeenCalledWith('guild-1');
  });

  test('update path: changing the channel updates channelIds (THE live bug)', async () => {
    configRepo = makeFakeConfigRepo({
      id: 1,
      guildId: 'guild-1',
      channelId: 'old-chan',
      channelIds: ['old-chan'],
      channelMessageId: null,
      gracePeriodSeconds: 15,
      actionType: 'ban',
      logChannelId: null,
    });
    const interaction = makeInteraction('new-chan');

    await setupHandler(mockClient, interaction);

    expect(configRepo.saveCalls.length).toBe(1);
    const saved = configRepo.saveCalls[0];
    // Pre-fix behavior: channelId='new-chan' but channelIds stayed ['old-chan']
    // → detection kept watching the old channel forever.
    expect(saved.channelIds).toEqual(['new-chan']);
    expect(saved.channelId).toBe('new-chan');
  });

  test('update path: preserves extra channels added via /baitchannel channels add', async () => {
    configRepo = makeFakeConfigRepo({
      id: 1,
      guildId: 'guild-1',
      channelId: 'old-primary',
      channelIds: ['old-primary', 'extra-1', 'extra-2'],
      channelMessageId: null,
      gracePeriodSeconds: 15,
      actionType: 'ban',
      logChannelId: null,
    });
    const interaction = makeInteraction('new-primary');

    await setupHandler(mockClient, interaction);

    const saved = configRepo.saveCalls[0];
    expect(saved.channelIds).toEqual(['new-primary', 'extra-1', 'extra-2']);
    expect(saved.channelId).toBe('new-primary');
  });

  test('update path: repairs a divergent row left behind by the pre-fix bug', async () => {
    // The bug's signature state: legacy column updated, channelIds stale.
    configRepo = makeFakeConfigRepo({
      id: 1,
      guildId: 'guild-1',
      channelId: 'written-by-bug',
      channelIds: ['stale-detected'],
      channelMessageId: null,
      gracePeriodSeconds: 15,
      actionType: 'ban',
      logChannelId: null,
    });
    const interaction = makeInteraction('final-chan');

    await setupHandler(mockClient, interaction);

    const saved = configRepo.saveCalls[0];
    expect(saved.channelIds).toEqual(['final-chan']);
    expect(saved.channelId).toBe('final-chan');
  });

  test('legacy-only row (channelIds null): update populates channelIds', async () => {
    configRepo = makeFakeConfigRepo({
      id: 1,
      guildId: 'guild-1',
      channelId: 'old-chan',
      channelIds: null,
      channelMessageId: null,
      gracePeriodSeconds: 15,
      actionType: 'ban',
      logChannelId: null,
    });
    const interaction = makeInteraction('new-chan');

    await setupHandler(mockClient, interaction);

    const saved = configRepo.saveCalls[0];
    expect(saved.channelIds).toEqual(['new-chan']);
    expect(saved.channelId).toBe('new-chan');
  });
});

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
let removeChannelHandler: typeof import('../../../../src/commands/handlers/baitChannel/setup').handleBaitChannelRemoveChannel;
let originalGetRepository: ((entity: any) => unknown) | undefined;

beforeAll(async () => {
  const { AppDataSource } = await import('../../../../src/typeorm');
  originalGetRepository = (AppDataSource as unknown as { getRepository: (e: any) => unknown }).getRepository;
  (AppDataSource as unknown as { getRepository: (e: any) => unknown }).getRepository = (entity: any) =>
    entity?.name === 'BaitChannelConfig' ? configRepo : benignRepo;
  const setupModule = await import('../../../../src/commands/handlers/baitChannel/setup');
  setupHandler = setupModule.setupHandler;
  removeChannelHandler = setupModule.handleBaitChannelRemoveChannel;
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
        // Update path fetches the old banner's channel to delete the warning
        // message; "channel gone" is an accepted outcome there.
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

describe('/baitchannel setup warning-banner lifecycle (v3.15.3)', () => {
  beforeEach(() => {
    clearConfigCache.mockClear();
  });

  test('channel change: old banner fetched from the LEGACY column channel, then id cleared', async () => {
    configRepo = makeFakeConfigRepo({
      id: 1,
      guildId: 'guild-1',
      channelId: 'banner-home',
      channelIds: ['banner-home'],
      channelMessageId: 'banner-msg',
      gracePeriodSeconds: 15,
      actionType: 'ban',
      logChannelId: null,
    });
    const interaction = makeInteraction('new-chan');

    await setupHandler(mockClient, interaction);

    // Deletion attempted where the banner actually lives
    expect(interaction.guild.channels.fetch).toHaveBeenCalledWith('banner-home');
    const saved = configRepo.saveCalls[0];
    expect(saved.channelMessageId).toBe(null);
    expect(saved.channelIds).toEqual(['new-chan']);
  });

  test('divergent row + setup with the legacy channel: banner kept, NOT re-fetched from stale channelIds', async () => {
    // The likely first admin action after the fix ships: re-running setup
    // with the channel they already chose (legacy=B, stale channelIds=[A]).
    // Keying off channelIds[0] would try to delete the banner in A (missing),
    // null the id, and post a duplicate banner in B.
    configRepo = makeFakeConfigRepo({
      id: 1,
      guildId: 'guild-1',
      channelId: 'chan-B',
      channelIds: ['stale-A'],
      channelMessageId: 'banner-msg',
      gracePeriodSeconds: 15,
      actionType: 'ban',
      logChannelId: null,
    });
    const interaction = makeInteraction('chan-B');

    await setupHandler(mockClient, interaction);

    expect(interaction.guild.channels.fetch).not.toHaveBeenCalled();
    const saved = configRepo.saveCalls[0];
    expect(saved.channelMessageId).toBe('banner-msg'); // banner untouched
    expect(saved.channelIds).toEqual(['chan-B']); // list repaired
    expect(saved.channelId).toBe('chan-B');
  });

  test('divergent row + setup with a third channel: banner deleted from the legacy channel', async () => {
    configRepo = makeFakeConfigRepo({
      id: 1,
      guildId: 'guild-1',
      channelId: 'chan-B',
      channelIds: ['stale-A'],
      channelMessageId: 'banner-msg',
      gracePeriodSeconds: 15,
      actionType: 'ban',
      logChannelId: null,
    });
    const interaction = makeInteraction('chan-C');

    await setupHandler(mockClient, interaction);

    expect(interaction.guild.channels.fetch).toHaveBeenCalledWith('chan-B'); // not stale-A
    const saved = configRepo.saveCalls[0];
    expect(saved.channelMessageId).toBe(null);
    expect(saved.channelIds).toEqual(['chan-C']);
  });

  test('same-channel re-run on a normal row is idempotent: no banner churn', async () => {
    configRepo = makeFakeConfigRepo({
      id: 1,
      guildId: 'guild-1',
      channelId: 'chan-X',
      channelIds: ['chan-X', 'extra-1'],
      channelMessageId: 'banner-msg',
      gracePeriodSeconds: 15,
      actionType: 'ban',
      logChannelId: null,
    });
    const interaction = makeInteraction('chan-X');

    await setupHandler(mockClient, interaction);

    expect(interaction.guild.channels.fetch).not.toHaveBeenCalled();
    const saved = configRepo.saveCalls[0];
    expect(saved.channelMessageId).toBe('banner-msg');
    expect(saved.channelIds).toEqual(['chan-X', 'extra-1']);
    expect(saved.channelId).toBe('chan-X');
  });
});

describe('/baitchannel setup remove-channel moves the warning banner (#38)', () => {
  /** Fake guild channels; `events` records the order of saves and Discord calls. */
  function makeRemoveInteraction(removeId: string, opts: { deleteFails?: boolean } = {}) {
    const events: string[] = [];
    const banner = {
      id: 'banner-msg',
      delete: jest.fn(async () => {
        events.push('delete-banner');
        if (opts.deleteFails) throw Object.assign(new Error('Missing Permissions'), { code: 50013 });
      }),
    };
    const channels: Record<string, any> = {
      'chan-A': { id: 'chan-A', isTextBased: () => true, messages: { fetch: jest.fn(async () => banner) } },
      'chan-B': {
        id: 'chan-B',
        isTextBased: () => true,
        send: jest.fn(async () => {
          events.push('post-banner');
          return { id: 'new-banner' };
        }),
      },
    };
    const interaction = {
      guildId: 'guild-1',
      guild: { id: 'guild-1', channels: { fetch: jest.fn(async (id: string) => channels[id] ?? null) } },
      options: { getChannel: () => ({ id: removeId }) },
      reply: jest.fn(async () => {}),
      replied: false,
      deferred: false,
    } as any;
    return { interaction, channels, banner, events };
  }

  function bannerRow() {
    return {
      id: 1,
      guildId: 'guild-1',
      channelId: 'chan-A',
      channelIds: ['chan-A', 'chan-B'],
      channelMessageId: 'banner-msg',
    };
  }

  test('removing the banner channel deletes its banner and posts one in the new primary', async () => {
    configRepo = makeFakeConfigRepo(bannerRow());
    const realSave = configRepo.save;
    const { interaction, channels, banner, events } = makeRemoveInteraction('chan-A');
    configRepo.save = async (e: any) => {
      events.push(`save:${e.channelMessageId}`);
      return realSave(e);
    };

    await removeChannelHandler(mockClient, interaction);

    expect(banner.delete).toHaveBeenCalledTimes(1);
    expect(channels['chan-B'].send).toHaveBeenCalledTimes(1);
    // Reference cleared and saved before the delete, so messageDelete's
    // cleanup has nothing stale to write back.
    expect(events).toEqual(['save:null', 'delete-banner', 'post-banner', 'save:new-banner']);
    expect(configRepo.row.channelIds).toEqual(['chan-B']);
    expect(configRepo.row.channelId).toBe('chan-B');
    expect(configRepo.row.channelMessageId).toBe('new-banner');
    const description = (interaction.reply.mock.calls[0] as any[])[0].embeds[0].toJSON().description;
    expect(description).not.toContain('warning banner');
  });

  test('removing a secondary channel leaves the banner alone', async () => {
    configRepo = makeFakeConfigRepo(bannerRow());
    const { interaction, banner } = makeRemoveInteraction('chan-B');

    await removeChannelHandler(mockClient, interaction);

    expect(interaction.guild.channels.fetch).not.toHaveBeenCalled();
    expect(banner.delete).not.toHaveBeenCalled();
    expect(configRepo.row.channelIds).toEqual(['chan-A']);
    expect(configRepo.row.channelMessageId).toBe('banner-msg');
  });

  test('a banner that cannot be deleted is reported in the reply; the removal still lands', async () => {
    configRepo = makeFakeConfigRepo(bannerRow());
    const { interaction } = makeRemoveInteraction('chan-A', { deleteFails: true });

    await removeChannelHandler(mockClient, interaction);

    expect(configRepo.row.channelIds).toEqual(['chan-B']);
    const description = (interaction.reply.mock.calls[0] as any[])[0].embeds[0].toJSON().description;
    expect(description).toContain("Couldn't delete the warning banner in <#chan-A>");
  });
});

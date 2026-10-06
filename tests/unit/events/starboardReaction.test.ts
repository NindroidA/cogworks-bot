/**
 * Starboard reaction handler + /starboard config-cache tests.
 *
 * Covers the v3.16.14 fixes:
 *  - the threshold uses the live API count (reaction.count is 0/1 because the
 *    client's reaction cache is disabled)
 *  - concurrent stars crossing the threshold produce exactly one post
 *  - unconfigured guilds / other emoji never trigger a REST fetch
 *  - /starboard setup, toggle, config and (un)ignore invalidate the cache
 *
 * Strategy: patch AppDataSource.getRepository to hand out stable fake repos
 * (lazyRepo caches the first repo it resolves, so state is reset in place).
 * The handler module is imported with a `?real` suffix because other event
 * tests mock.module('src/events/starboardReaction') process-wide.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from 'bun:test';
import { AppDataSource } from '../../../src/typeorm';

const GUILD = '100000000000000001';
const SOURCE_CHANNEL = '200000000000000001';
const STARBOARD_CHANNEL = '200000000000000002';
const MESSAGE = '300000000000000001';
const AUTHOR = '400000000000000001';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

// ---------------------------------------------------------------------------
// Fake repos
// ---------------------------------------------------------------------------

const configState = {
  row: null as Record<string, any> | null,
  updateCalls: [] as Array<{ where: any; patch: any }>,
  saveCalls: 0,
};

const fakeConfigRepo = {
  async findOneBy(where: { guildId: string }) {
    // Return a copy so the cached object and the "DB" row are distinct
    return configState.row && configState.row.guildId === where.guildId ? { ...configState.row } : null;
  },
  async findOne(opts: { where: { guildId: string } }) {
    return configState.row && configState.row.guildId === opts.where.guildId ? { ...configState.row } : null;
  },
  create(data: Record<string, unknown>) {
    return { ...data };
  },
  async save(entity: Record<string, any>) {
    configState.saveCalls++;
    configState.row = { ...entity };
    return entity;
  },
  async update(where: { guildId: string }, patch: Record<string, unknown>) {
    configState.updateCalls.push({ where, patch });
    if (configState.row?.guildId === where.guildId) Object.assign(configState.row, patch);
    return { affected: 1 };
  },
};

const entryState = {
  rows: [] as Array<Record<string, any>>,
  nextId: 1,
  failNextInsert: false,
};

const fakeEntryRepo = {
  async findOneBy(where: { guildId: string; originalMessageId: string }) {
    await tick(); // a real DB round trip — widens the race the lock closes
    return (
      entryState.rows.find(r => r.guildId === where.guildId && r.originalMessageId === where.originalMessageId) ?? null
    );
  },
  create(data: Record<string, unknown>) {
    return { ...data };
  },
  async save(entity: Record<string, any>) {
    await tick();
    if (entity.id) {
      const idx = entryState.rows.findIndex(r => r.id === entity.id);
      entryState.rows[idx] = { ...entity };
      return entity;
    }
    const dup = entryState.rows.some(
      r => r.guildId === entity.guildId && r.originalMessageId === entity.originalMessageId,
    );
    if (dup || entryState.failNextInsert) {
      entryState.failNextInsert = false;
      throw Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' });
    }
    entity.id = entryState.nextId++;
    entryState.rows.push({ ...entity });
    return entity;
  },
};

function resetState() {
  configState.row = {
    id: 1,
    guildId: GUILD,
    enabled: true,
    channelId: STARBOARD_CHANNEL,
    emoji: '⭐',
    threshold: 3,
    selfStar: false,
    ignoredChannels: null,
    ignoreBots: true,
    ignoreNSFW: false,
  };
  configState.updateCalls = [];
  configState.saveCalls = 0;
  entryState.rows = [];
  entryState.nextId = 1;
  entryState.failNextInsert = false;
}

// ---------------------------------------------------------------------------
// Fake Discord objects
// ---------------------------------------------------------------------------

function makeStarboardChannel() {
  const posts = new Map<string, any>();
  let n = 0;
  return {
    id: STARBOARD_CHANNEL,
    posts,
    send: jest.fn(async (payload: { embeds: Array<{ toJSON(): any }> }) => {
      await tick();
      const post: any = {
        id: `post-${++n}`,
        embeds: payload.embeds.map(e => e.toJSON()),
        edit: jest.fn(async (p: { embeds: Array<{ toJSON(): any }> }) => {
          post.embeds = p.embeds.map(e => e.toJSON());
          return post;
        }),
        delete: jest.fn(async () => {
          posts.delete(post.id);
        }),
      };
      posts.set(post.id, post);
      return post;
    }),
    messages: {
      fetch: jest.fn(async (id: string) => {
        const post = posts.get(id);
        if (!post) throw new Error('Unknown Message');
        return post;
      }),
    },
  };
}

type StarboardChannelFake = ReturnType<typeof makeStarboardChannel>;

function makeGuild(starboardChannel: StarboardChannelFake | null) {
  const cache = new Map<string, unknown>();
  if (starboardChannel) cache.set(STARBOARD_CHANNEL, starboardChannel);
  return { id: GUILD, channels: { cache } };
}

function makeMessage(guild: ReturnType<typeof makeGuild>, opts: { partial?: boolean } = {}) {
  const author = { id: AUTHOR, bot: false, tag: 'author#0001', displayAvatarURL: () => 'https://cdn/avatar.png' };
  const message: any = {
    id: MESSAGE,
    channelId: SOURCE_CHANNEL,
    guild,
    partial: opts.partial ?? false,
    channel: { id: SOURCE_CHANNEL, name: 'general', nsfw: false },
    author: opts.partial ? null : author,
    content: opts.partial ? null : 'hello world',
    attachments: { first: () => undefined },
  };
  message.fetch = jest.fn(async () => {
    message.partial = false;
    message.author = author;
    message.content = 'hello world';
    return message;
  });
  return message;
}

function makeReaction(message: any, opts: { emojiName?: string; reactors?: string[] } = {}) {
  const name = opts.emojiName ?? '⭐';
  return {
    message,
    partial: true,
    count: 1, // what discord.js reports with ReactionManager: 0 — must not be trusted
    emoji: { id: null, name, toString: () => name },
    fetch: jest.fn(async () => {
      throw new Error('reaction.fetch() should not be called');
    }),
    users: {
      fetch: jest.fn(async () => new Map((opts.reactors ?? []).map(id => [id, { id }]))),
    },
  } as any;
}

/** Client whose REST GET returns the live star count held in `live.count` */
function makeClient(live: { count: number }) {
  return {
    rest: {
      get: jest.fn(async () => {
        await tick();
        return { id: MESSAGE, reactions: [{ emoji: { id: null, name: '⭐' }, count: live.count }] };
      }),
    },
  } as any;
}

const user = { id: '500000000000000001', bot: false } as any;

// ---------------------------------------------------------------------------
// Module wiring
// ---------------------------------------------------------------------------

let handleAdd: typeof import('../../../src/events/starboardReaction').handleStarboardReactionAdd;
let handleRemove: typeof import('../../../src/events/starboardReaction').handleStarboardReactionRemove;
let cache: typeof import('../../../src/utils/starboard/configCache');
let commands: typeof import('../../../src/commands/handlers/starboard/setup');
let ignoreCommands: typeof import('../../../src/commands/handlers/starboard/ignore');
let originalGetRepository: ((entity: any) => unknown) | undefined;

beforeAll(async () => {
  originalGetRepository = (AppDataSource as unknown as { getRepository: (e: any) => unknown }).getRepository;
  (AppDataSource as unknown as { getRepository: (e: any) => unknown }).getRepository = (entity: any) => {
    if (entity?.name === 'StarboardConfig') return fakeConfigRepo;
    if (entity?.name === 'StarboardEntry') return fakeEntryRepo;
    throw new Error(`starboard test: no fake repo for ${entity?.name}`);
  };
  // @ts-expect-error -- query suffix sidesteps other files' process-wide mock.module of this path
  const handler = await import('../../../src/events/starboardReaction.ts?real');
  handleAdd = handler.handleStarboardReactionAdd;
  handleRemove = handler.handleStarboardReactionRemove;
  cache = await import('../../../src/utils/starboard/configCache');
  commands = await import('../../../src/commands/handlers/starboard/setup');
  ignoreCommands = await import('../../../src/commands/handlers/starboard/ignore');
});

afterAll(() => {
  if (originalGetRepository) {
    (AppDataSource as unknown as { getRepository: (e: any) => unknown }).getRepository = originalGetRepository;
  }
});

beforeEach(() => {
  resetState();
  cache.invalidateStarboardCache(GUILD);
});

// ---------------------------------------------------------------------------
// Threshold (#83)
// ---------------------------------------------------------------------------

describe('starboard threshold', () => {
  test('posts once the live API count reaches the threshold, even though reaction.count says 1', async () => {
    const channel = makeStarboardChannel();
    const message = makeMessage(makeGuild(channel));
    const client = makeClient({ count: 3 });

    await handleAdd(makeReaction(message), user, client);

    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(entryState.rows).toHaveLength(1);
    expect(entryState.rows[0].starCount).toBe(3);
    expect(entryState.rows[0].authorId).toBe(AUTHOR);
    expect(channel.posts.get('post-1').embeds[0].footer.text).toBe('⭐ 3 | #general');
  });

  test('a partial (uncached) message is fetched only once the threshold is met', async () => {
    const channel = makeStarboardChannel();
    const message = makeMessage(makeGuild(channel), { partial: true });
    const reaction = makeReaction(message);

    await handleAdd(reaction, user, makeClient({ count: 2 }));
    expect(message.fetch).not.toHaveBeenCalled();
    expect(reaction.users.fetch).not.toHaveBeenCalled();
    expect(channel.send).not.toHaveBeenCalled();

    await handleAdd(reaction, user, makeClient({ count: 5 }));
    expect(message.fetch).toHaveBeenCalledTimes(1);
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(entryState.rows[0].starCount).toBe(5);
    expect(entryState.rows[0].content).toBe('hello world');
    expect(reaction.fetch).not.toHaveBeenCalled();
  });

  test("the author's own star does not count when self-star is off", async () => {
    const channel = makeStarboardChannel();
    const message = makeMessage(makeGuild(channel));

    await handleAdd(makeReaction(message, { reactors: [AUTHOR, user.id, 'x'] }), user, makeClient({ count: 3 }));

    expect(channel.send).not.toHaveBeenCalled();
  });

  test('removing a star updates the existing post and keeps its author', async () => {
    const channel = makeStarboardChannel();
    const message = makeMessage(makeGuild(channel));
    const live = { count: 4 };
    const client = makeClient(live);

    await handleAdd(makeReaction(message), user, client);
    live.count = 2;
    // Remove events arrive on a partial message — no author/content needed
    const partialMessage = makeMessage(makeGuild(channel), { partial: true });
    await handleRemove(makeReaction(partialMessage), user, client);

    expect(entryState.rows[0].starCount).toBe(2);
    const embed = channel.posts.get('post-1').embeds[0];
    expect(embed.footer.text).toBe('⭐ 2 | #general');
    expect(embed.author.name).toBe('author#0001');
    expect(partialMessage.fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Concurrency (#93)
// ---------------------------------------------------------------------------

describe('starboard concurrency', () => {
  test('stars landing together produce exactly one post', async () => {
    const channel = makeStarboardChannel();
    const message = makeMessage(makeGuild(channel));
    const client = makeClient({ count: 4 });

    await Promise.all([
      handleAdd(makeReaction(message), { id: 'u1', bot: false } as any, client),
      handleAdd(makeReaction(message), { id: 'u2', bot: false } as any, client),
      handleAdd(makeReaction(message), { id: 'u3', bot: false } as any, client),
    ]);

    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(entryState.rows).toHaveLength(1);
    expect(entryState.rows[0].starCount).toBe(4);
  });

  test('a failed insert takes the just-sent post back down', async () => {
    const channel = makeStarboardChannel();
    const message = makeMessage(makeGuild(channel));
    entryState.failNextInsert = true;

    await handleAdd(makeReaction(message), user, makeClient({ count: 3 }));

    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(channel.posts.size).toBe(0);
    expect(entryState.rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Cheap checks before REST (#95)
// ---------------------------------------------------------------------------

describe('starboard skips REST for reactions it does not care about', () => {
  test('guild without a starboard', async () => {
    configState.row = null;
    const message = makeMessage(makeGuild(makeStarboardChannel()), { partial: true });
    const reaction = makeReaction(message);
    const client = makeClient({ count: 10 });

    await handleAdd(reaction, user, client);

    expect(client.rest.get).not.toHaveBeenCalled();
    expect(message.fetch).not.toHaveBeenCalled();
    expect(reaction.fetch).not.toHaveBeenCalled();
  });

  test('a different emoji', async () => {
    const message = makeMessage(makeGuild(makeStarboardChannel()), { partial: true });
    const client = makeClient({ count: 10 });

    await handleAdd(makeReaction(message, { emojiName: '👍' }), user, client);
    await handleRemove(makeReaction(message, { emojiName: '👍' }), user, client);

    expect(client.rest.get).not.toHaveBeenCalled();
    expect(message.fetch).not.toHaveBeenCalled();
  });

  test('un-starring a message that was never posted', async () => {
    const message = makeMessage(makeGuild(makeStarboardChannel()), { partial: true });
    const reaction = makeReaction(message);
    const client = makeClient({ count: 1 });

    await handleRemove(reaction, user, client);

    expect(client.rest.get).not.toHaveBeenCalled();
    expect(reaction.users.fetch).not.toHaveBeenCalled();
    expect(message.fetch).not.toHaveBeenCalled();
  });

  test('an ignored channel', async () => {
    configState.row!.ignoredChannels = [SOURCE_CHANNEL];
    const message = makeMessage(makeGuild(makeStarboardChannel()), { partial: true });
    const client = makeClient({ count: 10 });

    await handleAdd(makeReaction(message), user, client);

    expect(client.rest.get).not.toHaveBeenCalled();
  });

  test('a missing starboard channel disables starboard with a targeted update', async () => {
    const message = makeMessage(makeGuild(null));

    await handleAdd(makeReaction(message), user, makeClient({ count: 5 }));

    expect(configState.updateCalls).toEqual([{ where: { guildId: GUILD }, patch: { enabled: false } }]);
    expect(configState.saveCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Config cache invalidation (#96)
// ---------------------------------------------------------------------------

function makeInteraction(opts: { strings?: Record<string, string>; channelId?: string } = {}) {
  return {
    guildId: GUILD,
    guild: { id: GUILD },
    member: { permissions: { has: () => true } },
    isRepliable: () => true,
    options: {
      getString: (name: string) => opts.strings?.[name] ?? null,
      getInteger: () => null,
      getChannel: () => ({ id: opts.channelId ?? SOURCE_CHANNEL }),
    },
    reply: jest.fn(async () => undefined),
  } as any;
}

describe('/starboard commands invalidate the config cache', () => {
  test('toggle', async () => {
    expect((await cache.getStarboardConfig(GUILD))?.enabled).toBe(true); // primes the cache

    await commands.starboardToggleHandler(makeInteraction());

    expect((await cache.getStarboardConfig(GUILD))?.enabled).toBe(false);
  });

  test('config', async () => {
    await cache.getStarboardConfig(GUILD);

    await commands.starboardConfigHandler(makeInteraction({ strings: { setting: 'threshold', value: '7' } }));

    expect((await cache.getStarboardConfig(GUILD))?.threshold).toBe(7);
  });

  test('setup', async () => {
    await cache.getStarboardConfig(GUILD);

    await commands.starboardSetupHandler(makeInteraction({ channelId: '200000000000000009' }));

    expect((await cache.getStarboardConfig(GUILD))?.channelId).toBe('200000000000000009');
  });

  test('ignore and unignore', async () => {
    await cache.getStarboardConfig(GUILD);

    await ignoreCommands.starboardIgnoreHandler(makeInteraction({ channelId: SOURCE_CHANNEL }));
    expect((await cache.getStarboardConfig(GUILD))?.ignoredChannels).toEqual([SOURCE_CHANNEL]);

    await ignoreCommands.starboardUnignoreHandler(makeInteraction({ channelId: SOURCE_CHANNEL }));
    expect((await cache.getStarboardConfig(GUILD))?.ignoredChannels).toBeNull();
  });
});

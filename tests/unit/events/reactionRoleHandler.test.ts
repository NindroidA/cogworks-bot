/**
 * Reaction-role handler tests.
 *
 * Covers the v3.16.15 fixes:
 *  - animated / renamed custom emoji match their option by id
 *  - unique mode takes the user's previous reaction off over REST (the
 *    client's reaction cache is disabled, so the old cache lookup never hit)
 *  - add and remove have separate cooldowns, so a quick un-react still
 *    removes the role
 *  - reactions on messages that aren't menus never trigger a fetch
 *
 * Other event tests mock.module() the menu cache process-wide, and Bun keeps
 * the first mock's export names. So this file loads the real menu cache
 * through a `?real` specifier and re-installs its functions under the normal
 * path before importing the handler; the emoji parsing the handler needs
 * lives in its own (never mocked) module for the same reason.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, jest, mock, test } from 'bun:test';
import { Collection, Routes } from 'discord.js';
import { AppDataSource } from '../../../src/typeorm';
import { parseOptionEmoji, reactionRouteIdentifier } from '../../../src/utils/reactionRole/optionEmoji';

const GUILD = '100000000000000001';
const CHANNEL = '200000000000000001';
const RED = '600000000000000001';
const BLUE = '600000000000000002';
const PARTY = '600000000000000003';
const PARTY_EMOJI_ID = '700000000000000001';
const BLOB_EMOJI_ID = '700000000000000002';

const RED_CIRCLE = '🔴';
const BLUE_CIRCLE = '🔵';
const GAME = '🎮';

// ---------------------------------------------------------------------------
// Fake repo (stable object — lazyRepo caches the first repo it resolves)
// ---------------------------------------------------------------------------

const menus = new Map<string, any>();

const fakeMenuRepo = {
  async findOne(opts: { where: { messageId: string; guildId: string } }) {
    const menu = menus.get(opts.where.messageId);
    return menu && menu.guildId === opts.where.guildId ? menu : null;
  },
};

let messageSeq = 0;
function nextMessageId(): string {
  messageSeq++;
  return `3000000000000${String(messageSeq).padStart(5, '0')}`;
}

let userSeq = 0;
function nextUser() {
  userSeq++;
  return { id: `5000000000000${String(userSeq).padStart(5, '0')}`, bot: false, partial: false } as any;
}

function addMenu(mode: 'normal' | 'unique' | 'lock', options: Array<{ id: number; emoji: string; roleId: string }>) {
  const messageId = nextMessageId();
  menus.set(messageId, {
    id: messageSeq,
    guildId: GUILD,
    messageId,
    mode,
    options: options.map((o, i) => ({ ...o, sortOrder: i })),
  });
  return messageId;
}

// ---------------------------------------------------------------------------
// Fake Discord objects
// ---------------------------------------------------------------------------

/**
 * The fake role manager updates the member cache as soon as a call resolves.
 * That is the state once GUILD_MEMBER_UPDATE has arrived: discord.js itself
 * leaves the cached member alone after `roles.set/add/remove` until then.
 */
function makeGuild(memberRoleIds: string[] = []) {
  const roles = new Collection<string, { id: string }>(
    [RED, BLUE, PARTY].map(id => [id, { id }] as [string, { id: string }]),
  );
  const memberRoles = new Collection<string, { id: string }>(memberRoleIds.map(id => [id, { id }]));
  const member = {
    roles: {
      cache: memberRoles,
      add: jest.fn(async (role: { id: string }) => {
        memberRoles.set(role.id, role);
      }),
      remove: jest.fn(async (role: { id: string }) => {
        memberRoles.delete(role.id);
      }),
      set: jest.fn(async (next: Collection<string, { id: string }>) => {
        memberRoles.clear();
        for (const [id, role] of next) memberRoles.set(id, role);
      }),
    },
  };
  return { id: GUILD, roles: { cache: roles }, members: { fetch: jest.fn(async () => member) }, member };
}

function makeReaction(
  guild: ReturnType<typeof makeGuild>,
  messageId: string,
  emoji: { id: string | null; name: string; animated?: boolean | null },
) {
  return {
    partial: true,
    fetch: jest.fn(async () => {
      throw new Error('reaction.fetch() should not be called');
    }),
    message: { id: messageId, channelId: CHANNEL, guild, partial: true },
    emoji: { animated: null, ...emoji },
  } as any;
}

const makeClient = () => ({ rest: { delete: jest.fn(async () => undefined) } }) as any;

// ---------------------------------------------------------------------------
// Module wiring
// ---------------------------------------------------------------------------

let handlers: typeof import('../../../src/events/reactionRoleHandler');
let menuCache: typeof import('../../../src/utils/reactionRole/menuCache');
let originalGetRepository: ((entity: any) => unknown) | undefined;

beforeAll(async () => {
  originalGetRepository = (AppDataSource as unknown as { getRepository: (e: any) => unknown }).getRepository;
  (AppDataSource as unknown as { getRepository: (e: any) => unknown }).getRepository = (entity: any) => {
    if (entity?.name === 'ReactionRoleMenu') return fakeMenuRepo;
    throw new Error(`reactionRole test: no fake repo for ${entity?.name}`);
  };

  // @ts-expect-error -- query suffix loads the real module even if another file mocked this path
  menuCache = await import('../../../src/utils/reactionRole/menuCache.ts?real');
  mock.module('../../../src/utils/reactionRole/menuCache', () => ({ ...menuCache }));

  handlers = await import('../../../src/events/reactionRoleHandler');
});

afterAll(() => {
  handlers.stopReactionRoleCooldownCleanup();
  if (originalGetRepository) {
    (AppDataSource as unknown as { getRepository: (e: any) => unknown }).getRepository = originalGetRepository;
  }
});

beforeEach(() => {
  for (const messageId of menus.keys()) menuCache.invalidateMenuCache(messageId);
  menus.clear();
});

// ---------------------------------------------------------------------------
// Stored option emoji
// ---------------------------------------------------------------------------

describe('stored option emoji', () => {
  test.each([
    [`<a:partyblob:${PARTY_EMOJI_ID}>`, PARTY_EMOJI_ID, 'partyblob'],
    [`<:blob:${BLOB_EMOJI_ID}>`, BLOB_EMOJI_ID, 'blob'],
    [`blob:${BLOB_EMOJI_ID}`, BLOB_EMOJI_ID, 'blob'],
    [`a:partyblob:${PARTY_EMOJI_ID}`, PARTY_EMOJI_ID, 'partyblob'],
    [`abc:${BLOB_EMOJI_ID}`, BLOB_EMOJI_ID, 'abc'],
  ])('%s is custom emoji %s', (raw, id, name) => {
    expect(parseOptionEmoji(raw)).toEqual({ id, name });
  });

  test('unicode emoji keep their value and have no id', () => {
    expect(parseOptionEmoji(RED_CIRCLE)).toEqual({ id: null, name: RED_CIRCLE });
  });

  test('REST identifiers are name:id for custom emoji and URL-encoded unicode otherwise', () => {
    expect(reactionRouteIdentifier(`<a:partyblob:${PARTY_EMOJI_ID}>`)).toBe(`partyblob:${PARTY_EMOJI_ID}`);
    expect(reactionRouteIdentifier(RED_CIRCLE)).toBe(encodeURIComponent(RED_CIRCLE));
  });
});

// ---------------------------------------------------------------------------
// Emoji matching (#86)
// ---------------------------------------------------------------------------

describe('reaction-role emoji matching', () => {
  test('animated custom emoji grant and remove their role', async () => {
    const messageId = addMenu('normal', [{ id: 1, emoji: `<a:partyblob:${PARTY_EMOJI_ID}>`, roleId: PARTY }]);
    const guild = makeGuild();
    const user = nextUser();

    await handlers.handleReactionRoleAdd(
      makeReaction(guild, messageId, { id: PARTY_EMOJI_ID, name: 'partyblob', animated: true }),
      user,
      makeClient(),
    );
    expect(guild.member.roles.add).toHaveBeenCalledTimes(1);
    expect(guild.member.roles.cache.has(PARTY)).toBe(true);

    // Remove events can arrive without the animated flag — still matched by id
    await handlers.handleReactionRoleRemove(
      makeReaction(guild, messageId, { id: PARTY_EMOJI_ID, name: 'partyblob', animated: null }),
      user,
      makeClient(),
    );
    expect(guild.member.roles.cache.has(PARTY)).toBe(false);
  });

  test('a renamed custom emoji still matches by id', async () => {
    const messageId = addMenu('normal', [{ id: 1, emoji: `<:oldname:${BLOB_EMOJI_ID}>`, roleId: BLUE }]);
    const guild = makeGuild();

    await handlers.handleReactionRoleAdd(
      makeReaction(guild, messageId, { id: BLOB_EMOJI_ID, name: 'newname' }),
      nextUser(),
      makeClient(),
    );

    expect(guild.member.roles.cache.has(BLUE)).toBe(true);
  });

  test('unicode emoji match by name', async () => {
    const messageId = addMenu('normal', [{ id: 1, emoji: RED_CIRCLE, roleId: RED }]);
    const guild = makeGuild();

    await handlers.handleReactionRoleAdd(
      makeReaction(guild, messageId, { id: null, name: RED_CIRCLE }),
      nextUser(),
      makeClient(),
    );

    expect(guild.member.roles.cache.has(RED)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unique mode (#87)
// ---------------------------------------------------------------------------

describe('unique mode', () => {
  test("switching options removes the user's previous reaction over REST", async () => {
    const messageId = addMenu('unique', [
      { id: 1, emoji: RED_CIRCLE, roleId: RED },
      { id: 2, emoji: BLUE_CIRCLE, roleId: BLUE },
      { id: 3, emoji: `<a:partyblob:${PARTY_EMOJI_ID}>`, roleId: PARTY },
    ]);
    const guild = makeGuild([RED]);
    const user = nextUser();
    const client = makeClient();

    await handlers.handleReactionRoleAdd(makeReaction(guild, messageId, { id: null, name: BLUE_CIRCLE }), user, client);

    expect([...guild.member.roles.cache.keys()]).toEqual([BLUE]);
    // Only the option whose role the member held — not one DELETE per option
    expect(client.rest.delete).toHaveBeenCalledTimes(1);
    expect(client.rest.delete).toHaveBeenCalledWith(
      Routes.channelMessageUserReaction(CHANNEL, messageId, encodeURIComponent(RED_CIRCLE), user.id),
    );
  });

  test('custom emoji reactions are removed by name:id', async () => {
    const messageId = addMenu('unique', [
      { id: 1, emoji: `<a:partyblob:${PARTY_EMOJI_ID}>`, roleId: PARTY },
      { id: 2, emoji: BLUE_CIRCLE, roleId: BLUE },
    ]);
    const guild = makeGuild([PARTY]);
    const user = nextUser();
    const client = makeClient();

    await handlers.handleReactionRoleAdd(makeReaction(guild, messageId, { id: null, name: BLUE_CIRCLE }), user, client);

    expect(client.rest.delete).toHaveBeenCalledWith(
      Routes.channelMessageUserReaction(CHANNEL, messageId, `partyblob:${PARTY_EMOJI_ID}`, user.id),
    );
  });

  test('a first pick makes no REST calls', async () => {
    const messageId = addMenu('unique', [
      { id: 1, emoji: RED_CIRCLE, roleId: RED },
      { id: 2, emoji: BLUE_CIRCLE, roleId: BLUE },
    ]);
    const client = makeClient();

    await handlers.handleReactionRoleAdd(
      makeReaction(makeGuild(), messageId, { id: null, name: RED_CIRCLE }),
      nextUser(),
      client,
    );

    expect(client.rest.delete).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Cooldown per direction (#89)
// ---------------------------------------------------------------------------

describe('reaction cooldown', () => {
  test('a quick un-react after a react still removes the role', async () => {
    const messageId = addMenu('normal', [{ id: 1, emoji: GAME, roleId: RED }]);
    const guild = makeGuild();
    const user = nextUser();
    const reaction = makeReaction(guild, messageId, { id: null, name: GAME });

    await handlers.handleReactionRoleAdd(reaction, user, makeClient());
    await handlers.handleReactionRoleRemove(reaction, user, makeClient());

    expect(guild.member.roles.add).toHaveBeenCalledTimes(1);
    expect(guild.member.roles.remove).toHaveBeenCalledTimes(1);
    expect(guild.member.roles.cache.has(RED)).toBe(false);
  });

  test('a repeated add within the window is still throttled', async () => {
    const messageId = addMenu('normal', [{ id: 1, emoji: GAME, roleId: RED }]);
    const guild = makeGuild();
    const user = nextUser();
    const reaction = makeReaction(guild, messageId, { id: null, name: GAME });

    await handlers.handleReactionRoleAdd(reaction, user, makeClient());
    await handlers.handleReactionRoleAdd(reaction, user, makeClient());

    expect(guild.members.fetch).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// No REST for unrelated reactions (#95)
// ---------------------------------------------------------------------------

describe('reactions on messages that are not menus', () => {
  test('never fetch the reaction, user or member', async () => {
    const guild = makeGuild();
    const reaction = makeReaction(guild, nextMessageId(), { id: null, name: '👍' });
    const user = { id: '500000000000099999', bot: false, partial: true, fetch: jest.fn() } as any;

    await handlers.handleReactionRoleAdd(reaction, user, makeClient());
    await handlers.handleReactionRoleRemove(reaction, user, makeClient());

    expect(reaction.fetch).not.toHaveBeenCalled();
    expect(user.fetch).not.toHaveBeenCalled();
    expect(guild.members.fetch).not.toHaveBeenCalled();
  });
});

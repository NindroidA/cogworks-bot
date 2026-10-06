/**
 * Rules reaction handler tests.
 *
 * Covers the v3.16.15 cooldown fix: add and remove used one 2-second
 * cooldown per user and message, so an un-react within 2s was dropped and the
 * member kept the rules role with no reaction showing. Each direction now has
 * its own key.
 *
 * Other event tests mock.module() the rules cache process-wide with only
 * `invalidateRulesCache`, so this file loads the real cache through a `?real`
 * specifier and re-installs it under the normal path before importing the
 * handler (the same approach as reactionRoleHandler.test.ts).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, jest, mock, test } from 'bun:test';
import { Collection } from 'discord.js';
import { AppDataSource } from '../../../src/typeorm';

const GUILD = '100000000000000001';
const CHANNEL = '200000000000000001';
const VERIFIED = '600000000000000001';
const EMOJI = '✅';

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

// ---------------------------------------------------------------------------
// Fake repo (stable object: lazyRepo caches the first repo it resolves)
// ---------------------------------------------------------------------------

const rulesConfigs = new Map<string, any>();

const fakeRulesRepo = {
  async findOneBy(where: { guildId: string; messageId: string }) {
    const config = rulesConfigs.get(where.messageId);
    return config && config.guildId === where.guildId ? config : null;
  },
};

function addRulesMessage(): string {
  const messageId = nextMessageId();
  rulesConfigs.set(messageId, {
    id: messageSeq,
    guildId: GUILD,
    channelId: CHANNEL,
    messageId,
    roleId: VERIFIED,
    emoji: EMOJI,
  });
  return messageId;
}

// ---------------------------------------------------------------------------
// Fake Discord objects
// ---------------------------------------------------------------------------

/**
 * The fake role manager updates the member cache as soon as the call
 * resolves. That is the state once GUILD_MEMBER_UPDATE has arrived; discord.js
 * itself leaves the cached member alone until then.
 */
function makeGuild() {
  const memberRoles = new Collection<string, { id: string }>();
  const member = {
    roles: {
      cache: memberRoles,
      add: jest.fn(async (role: { id: string }) => {
        memberRoles.set(role.id, role);
      }),
      remove: jest.fn(async (role: { id: string }) => {
        memberRoles.delete(role.id);
      }),
    },
  };
  const roles = new Collection<string, { id: string }>([[VERIFIED, { id: VERIFIED }]]);
  return { id: GUILD, roles: { cache: roles }, members: { fetch: jest.fn(async () => member) }, member };
}

function makeReaction(guild: ReturnType<typeof makeGuild>, messageId: string, emojiName = EMOJI) {
  return {
    partial: false,
    message: { id: messageId, channelId: CHANNEL, guild, partial: false },
    emoji: { id: null, name: emojiName, toString: () => emojiName },
  } as any;
}

const client = {} as any;

// ---------------------------------------------------------------------------
// Module wiring
// ---------------------------------------------------------------------------

let handlers: typeof import('../../../src/events/rulesReaction');
let originalGetRepository: ((entity: any) => unknown) | undefined;

beforeAll(async () => {
  originalGetRepository = (AppDataSource as unknown as { getRepository: (e: any) => unknown }).getRepository;
  (AppDataSource as unknown as { getRepository: (e: any) => unknown }).getRepository = (entity: any) => {
    if (entity?.name === 'RulesConfig') return fakeRulesRepo;
    throw new Error(`rulesReaction test: no fake repo for ${entity?.name}`);
  };

  // @ts-expect-error -- query suffix loads the real module even if another file mocked this path
  const rulesCache = await import('../../../src/utils/rules/rulesCache.ts?real');
  mock.module('../../../src/utils/rules/rulesCache', () => ({ ...rulesCache }));

  handlers = await import('../../../src/events/rulesReaction');
});

afterAll(() => {
  handlers.stopRulesCooldownCleanup();
  if (originalGetRepository) {
    (AppDataSource as unknown as { getRepository: (e: any) => unknown }).getRepository = originalGetRepository;
  }
});

beforeEach(() => {
  rulesConfigs.clear();
});

// ---------------------------------------------------------------------------
// Cooldown per direction (#89)
// ---------------------------------------------------------------------------

describe('rules reaction cooldown', () => {
  test('a quick un-react after a react removes the role', async () => {
    const messageId = addRulesMessage();
    const guild = makeGuild();
    const user = nextUser();

    await handlers.handleRulesReactionAdd(makeReaction(guild, messageId), user, client);
    expect(guild.member.roles.cache.has(VERIFIED)).toBe(true);

    await handlers.handleRulesReactionRemove(makeReaction(guild, messageId), user, client);

    expect(guild.member.roles.remove).toHaveBeenCalledTimes(1);
    expect(guild.member.roles.cache.has(VERIFIED)).toBe(false);
  });

  test('a quick re-react after an un-react gives the role back', async () => {
    const messageId = addRulesMessage();
    const guild = makeGuild();
    const user = nextUser();
    guild.member.roles.cache.set(VERIFIED, { id: VERIFIED });

    await handlers.handleRulesReactionRemove(makeReaction(guild, messageId), user, client);
    expect(guild.member.roles.cache.has(VERIFIED)).toBe(false);

    await handlers.handleRulesReactionAdd(makeReaction(guild, messageId), user, client);

    expect(guild.member.roles.add).toHaveBeenCalledTimes(1);
    expect(guild.member.roles.cache.has(VERIFIED)).toBe(true);
  });

  test('a repeated add within the window is still throttled', async () => {
    const messageId = addRulesMessage();
    const guild = makeGuild();
    const user = nextUser();

    await handlers.handleRulesReactionAdd(makeReaction(guild, messageId), user, client);
    await handlers.handleRulesReactionAdd(makeReaction(guild, messageId), user, client);

    expect(guild.members.fetch).toHaveBeenCalledTimes(1);
  });
});

/**
 * XP event handlers (v3.16.33).
 *
 * Voice XP is earned in segments: nothing counts in the AFK channel, in an
 * XP-ignored channel or while deafened, each segment uses its own channel's
 * multiplier, and a voice level-up grants role rewards. Message XP treats a
 * thread as its parent channel for ignores and multipliers, and a level-up
 * announcement pings only the member who leveled.
 *
 * Repositories come from a patched AppDataSource.getRepository that returns
 * forwarding proxies (a handler's lazyRepo may cache one; after this suite it
 * forwards to whatever getRepository is installed then).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from 'bun:test';
import { Collection } from 'discord.js';
import { AppDataSource } from '../../../src/typeorm';
import { XPConfig } from '../../../src/typeorm/entities/xp/XPConfig';
import { XPRoleReward } from '../../../src/typeorm/entities/xp/XPRoleReward';
import { XPUser } from '../../../src/typeorm/entities/xp/XPUser';

const USER_ID = '200000000000000001';
const AFK = '400000000000000001';
const GENERAL = '400000000000000002';
const IGNORED = '400000000000000003';
const DOUBLE = '400000000000000004';
const REWARD_ROLE = '300000000000000001';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const db = {
  config: null as Record<string, any> | null,
  user: null as Record<string, any> | null,
  rewards: [] as Array<Record<string, any>>,
};

const fakes = new Map<unknown, Record<string, unknown>>([
  [XPConfig, { findOne: async () => db.config }],
  [
    XPUser,
    {
      findOne: async () => db.user,
      create: (data: Record<string, unknown>) => ({ xp: 0, level: 0, messages: 0, voiceMinutes: 0, ...data }),
      save: async (entity: Record<string, any>) => {
        db.user = entity;
        return entity;
      },
      increment: async () => undefined,
    },
  ],
  [XPRoleReward, { find: async () => db.rewards }],
]);

type GetRepository = (entity: unknown) => unknown;
const ds = AppDataSource as unknown as { getRepository: GetRepository };
let originalGetRepository: GetRepository;
let active = false;

function forwardingRepo(entity: unknown): object {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        const repo = (active ? fakes.get(entity) : ds.getRepository(entity)) as Record<string | symbol, unknown>;
        const value = repo[prop];
        return typeof value === 'function' ? value.bind(repo) : value;
      },
    },
  );
}

let guildSeq = 0;
let guildId = '';

function makeMember(roleIds: string[] = []) {
  const roles = new Collection(roleIds.map(id => [id, { id }]));
  return {
    id: USER_ID,
    user: { bot: false },
    guild: { id: guildId, channels: { cache: new Map() } },
    roles: { cache: roles, add: jest.fn(async () => undefined), remove: jest.fn(async () => undefined) },
  };
}

function voiceState(channelId: string | null, opts: { deaf?: boolean; member?: ReturnType<typeof makeMember> } = {}) {
  return {
    channelId,
    deaf: opts.deaf ?? false,
    member: opts.member ?? makeMember(),
    guild: { id: guildId, afkChannelId: AFK, members: { fetch: async () => null } },
  } as any;
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

let xpVoice: typeof import('../../../src/events/xpVoiceHandler');
let xpMessage: typeof import('../../../src/events/xpMessageHandler').default;
let handleLevelUp: typeof import('../../../src/utils/xp/levelUp').handleLevelUp;

beforeAll(async () => {
  originalGetRepository = ds.getRepository;
  active = true;
  ds.getRepository = (entity: unknown) => {
    if (fakes.has(entity)) return forwardingRepo(entity);
    throw new Error(`xpHandlers test: no fake for ${(entity as { name?: string })?.name}`);
  };
  xpVoice = await import('../../../src/events/xpVoiceHandler');
  xpMessage = (await import('../../../src/events/xpMessageHandler')).default;
  ({ handleLevelUp } = await import('../../../src/utils/xp/levelUp'));
});

afterAll(() => {
  active = false;
  ds.getRepository = originalGetRepository;
});

beforeEach(() => {
  // A fresh guild per test: the XP config cache is keyed by guild
  guildSeq++;
  guildId = `1000000000000${String(guildSeq).padStart(5, '0')}`;
  db.config = {
    guildId,
    enabled: true,
    voiceXpEnabled: true,
    xpPerVoiceMinute: 5,
    xpPerMessageMin: 10,
    xpPerMessageMax: 10,
    xpCooldownSeconds: 60,
    levelUpChannelId: null,
    levelUpMessage: 'GG {user}, level {level}!',
    ignoredChannels: [IGNORED],
    ignoredRoles: null,
    multiplierChannels: { [DOUBLE]: 2 },
  };
  db.user = null;
  db.rewards = [];
});

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

describe('earnsVoiceXp', () => {
  const config = { ignoredChannels: [IGNORED], ignoredRoles: ['300000000000000009'] };

  test('a member in a counted channel earns', () => {
    expect(xpVoice.earnsVoiceXp(voiceState(GENERAL), config)).toBe(true);
  });

  test.each([
    ['not in voice', voiceState(null)],
    ['in the AFK channel', voiceState(AFK)],
    ['in an XP-ignored channel', voiceState(IGNORED)],
    ['deafened', voiceState(GENERAL, { deaf: true })],
    ['holding an XP-ignored role', voiceState(GENERAL, { member: makeMember(['300000000000000009']) })],
  ])('a member %s does not earn', (_label, state) => {
    expect(xpVoice.earnsVoiceXp(state, config)).toBe(false);
  });
});

describe('voice XP segments', () => {
  test('joining a counted channel opens a segment; joining the AFK channel does not', async () => {
    await xpVoice.default.execute(voiceState(null), voiceState(AFK), {} as never);
    expect(db.user).toBeNull();

    await xpVoice.default.execute(voiceState(null), voiceState(GENERAL), {} as never);
    expect(db.user?.lastVoiceJoinedAt).toBeInstanceOf(Date);
  });

  test('moving to the AFK channel closes the segment; leaving AFK later awards nothing more', async () => {
    db.user = { guildId, userId: USER_ID, xp: 0, level: 0, voiceMinutes: 0, lastVoiceJoinedAt: minutesAgo(10) };

    await xpVoice.default.execute(voiceState(GENERAL), voiceState(AFK), {} as never);
    expect(db.user).toMatchObject({ xp: 50, voiceMinutes: 10, lastVoiceJoinedAt: null });

    await xpVoice.default.execute(voiceState(AFK), voiceState(null), {} as never);
    expect(db.user).toMatchObject({ xp: 50, voiceMinutes: 10 });
  });

  test('deafening closes the segment and undeafening opens a new one', async () => {
    db.user = { guildId, userId: USER_ID, xp: 0, level: 0, voiceMinutes: 0, lastVoiceJoinedAt: minutesAgo(4) };

    await xpVoice.default.execute(voiceState(GENERAL), voiceState(GENERAL, { deaf: true }), {} as never);
    expect(db.user).toMatchObject({ xp: 20, lastVoiceJoinedAt: null });

    await xpVoice.default.execute(voiceState(GENERAL, { deaf: true }), voiceState(GENERAL), {} as never);
    expect(db.user?.lastVoiceJoinedAt).toBeInstanceOf(Date);
  });

  test("switching channels awards the segment at the old channel's multiplier and opens a new one", async () => {
    db.user = { guildId, userId: USER_ID, xp: 0, level: 0, voiceMinutes: 0, lastVoiceJoinedAt: minutesAgo(3) };

    await xpVoice.default.execute(voiceState(DOUBLE), voiceState(GENERAL), {} as never);

    expect(db.user).toMatchObject({ xp: 30, voiceMinutes: 3 });
    expect(db.user?.lastVoiceJoinedAt).toBeInstanceOf(Date);
  });

  test('a voice level-up grants role rewards without posting anywhere', async () => {
    db.rewards = [{ guildId, level: 1, roleId: REWARD_ROLE, removeOnDelevel: false }];
    db.user = { guildId, userId: USER_ID, xp: 0, level: 0, voiceMinutes: 0, lastVoiceJoinedAt: minutesAgo(20) };
    const member = makeMember();

    await xpVoice.default.execute(voiceState(GENERAL, { member }), voiceState(null, { member }), {} as never);

    expect(db.user).toMatchObject({ xp: 100, level: 1 });
    expect(member.roles.add).toHaveBeenCalledWith(REWARD_ROLE, 'XP Level 1 reward');
  });
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function makeMessage(channel: { id: string; parentId?: string }) {
  const send = jest.fn(async () => undefined);
  return {
    message: {
      guild: { id: guildId },
      author: { id: USER_ID, bot: false },
      member: makeMember(),
      channelId: channel.id,
      channel: { isThread: () => !!channel.parentId, parentId: channel.parentId ?? null, isTextBased: () => true, send },
    } as any,
    send,
  };
}

describe('message XP in threads', () => {
  test('a thread under an ignored channel earns nothing', async () => {
    const { message } = makeMessage({ id: '500000000000000001', parentId: IGNORED });
    await xpMessage.execute(message, {} as never);
    expect(db.user).toBeNull();
  });

  test("a thread uses its parent's multiplier", async () => {
    const { message } = makeMessage({ id: '500000000000000002', parentId: DOUBLE });
    await xpMessage.execute(message, {} as never);
    expect(db.user?.xp).toBe(20);
  });
});

describe('level-up announcement', () => {
  test('pings only the member who leveled', async () => {
    const member = makeMember();
    const send = jest.fn(async () => undefined);

    await handleLevelUp(
      member as never,
      { guildId, levelUpChannelId: null, levelUpMessage: '@everyone {user} reached {level}' },
      3,
      { send } as never,
    );

    expect(send).toHaveBeenCalledWith({
      content: `@everyone <@${USER_ID}> reached 3`,
      allowedMentions: { users: [USER_ID] },
    });
  });
});

// ---------------------------------------------------------------------------
// /xp-setup role-reward-add
// ---------------------------------------------------------------------------

describe('/xp-setup role-reward-add', () => {
  test('a non-admin XP manager cannot make an Administrator role a reward', async () => {
    const { xpSetupHandler } = await import('../../../src/commands/handlers/xp/setup');
    const { PermissionFlagsBits, PermissionsBitField } = await import('discord.js');
    const { lang } = await import('../../../src/lang');
    const reply = jest.fn(async () => undefined);
    const interaction = {
      guildId,
      guild: {
        id: guildId,
        ownerId: '200000000000000099',
        members: {
          fetchMe: async () => ({ roles: { highest: { position: 20 } } }),
          fetch: async () => ({ roles: { highest: { position: 10 } } }),
        },
      },
      user: { id: USER_ID },
      memberPermissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild),
      deferred: false,
      replied: false,
      isRepliable: () => true,
      options: {
        getSubcommand: () => 'role-reward-add',
        getInteger: () => 1,
        getBoolean: () => null,
        getRole: () => ({ id: REWARD_ROLE, name: 'Admin', managed: false, position: 5, permissions: String(PermissionFlagsBits.Administrator) }),
      },
      reply,
    };

    await xpSetupHandler({} as never, interaction as never);

    expect((reply.mock.calls[0] as any[])[0].content).toContain(lang.errors.assignableRole.privileged);
  });
});

/**
 * Bait grace-period safety tests (cogworks-bot#41).
 *
 * A grace period must never turn into a real action when the guild is in
 * test mode, the user deleted their message, the user was whitelisted, or the
 * feature was turned off during the window; it must persist the action it
 * stands for (not the column default 'ban'); a leave in one guild must never
 * touch another guild's timer; a leave that was a ban must never be softened
 * into a softban (its unban step would lift the ban); and a dashboard cancel
 * must stop the timer. After a restart, a restored grace period settles the
 * same way when its window closes, and boot leaves retry and dead-letter rows
 * alone.
 *
 * Runs the real executeAction + REST executor against hand-rolled fakes, so
 * "no real action" is asserted at the Discord call (guild.bans.create /
 * member.timeout), not at an internal seam. Timers are set to an hour and
 * resolved by hand, so nothing fires on its own, except in the one test that
 * lets the real timer fire.
 */

import { afterEach, describe, expect, jest, test } from 'bun:test';
import { DiscordAPIError } from 'discord.js';
import { BaitChannelManager } from '../../../../src/utils/baitChannel/baitChannelManager';
import { getRetryQueue, initRetryQueue, stopRetryQueue } from '../../../../src/utils/baitChannel/retryQueue';

const GUILD = 'guild-1';
const USER = 'user-1';
const BAIT = 'bait-1';

function makeConfig(overrides: Record<string, unknown> = {}): any {
  return {
    guildId: GUILD,
    enabled: true,
    channelId: BAIT,
    channelIds: [BAIT],
    actionType: 'ban',
    enableEscalation: false,
    gracePeriodSeconds: 3600,
    testMode: false,
    dmBeforeAction: false,
    deleteUserMessages: false,
    deleteMessageHours: 24,
    timeoutDurationMinutes: 60,
    logChannelId: null,
    whitelistedUsers: null,
    whitelistedRoles: null,
    disableAdminWhitelist: false,
    enableRaidMode: false,
    warningMessage: 'This channel is a trap.',
    ...overrides,
  };
}

const apiError = (code: number, status: number) =>
  new DiscordAPIError({ message: `error ${code}`, code }, code, status, 'GET', '/test', {
    body: undefined,
    files: undefined,
  });

/** `banned` is the ban list as Discord would report it; without BanMembers the lookup itself is refused. */
function makeGuild(id = GUILD, opts: { canBan?: boolean; banned?: boolean } = {}): any {
  const canBan = opts.canBan ?? true;
  return {
    id,
    name: `Guild ${id}`,
    ownerId: 'owner-99',
    members: { me: { permissions: { has: () => canBan } } },
    bans: {
      create: jest.fn(async () => {
        if (!canBan) throw apiError(50013, 403);
      }),
      remove: jest.fn(async () => undefined),
      fetch: jest.fn(async () => {
        if (!canBan) throw apiError(50013, 403);
        if (!opts.banned) throw apiError(10026, 404);
        return { user: { id: USER } };
      }),
    },
    channels: { fetch: jest.fn(async () => null) },
  };
}

function makeMember(guild: any): any {
  return {
    id: USER,
    guild,
    user: { tag: 'user-1#0001', createdTimestamp: Date.now() - 86_400_000 },
    joinedTimestamp: Date.now() - 60_000,
    joinedAt: null,
    roles: { cache: { find: () => undefined, some: () => false } },
    permissions: { has: () => false },
    send: jest.fn(async () => undefined),
    timeout: jest.fn(async () => undefined),
    kick: jest.fn(async () => undefined),
  };
}

function makeMessage(guild: any, member: any, id = 'msg-1'): { message: any; warning: any } {
  const warning = { id: `warn-${id}`, delete: jest.fn(async () => undefined) };
  const message: any = {
    id,
    content: 'free nitro',
    channelId: BAIT,
    channel: { name: 'bait' },
    guild,
    member,
    author: { id: USER, bot: false },
    system: false,
    delete: jest.fn(async () => undefined),
    reply: jest.fn(async () => warning),
  };
  message.fetch = jest.fn(async () => message);
  return { message, warning };
}

const analysis = (score = 60) => ({ score, flags: {}, reasons: [] }) as any;

function fakeRepo(): any {
  return {
    findOne: jest.fn(async () => null),
    find: jest.fn(async () => []),
    create: jest.fn((x: any) => x),
    save: jest.fn(async (x: any) => x),
    delete: jest.fn(async () => ({ affected: 1 })),
    remove: jest.fn(async (x: any) => x),
    update: jest.fn(async () => ({ affected: 1 })),
  };
}

const managers: BaitChannelManager[] = [];

function makeHarness(configOverrides: Record<string, unknown> = {}) {
  const state = { config: makeConfig(configOverrides) };
  const configRepo = { ...fakeRepo(), findOne: jest.fn(async () => state.config) };
  const logRepo = fakeRepo();
  const pendingActionRepo = fakeRepo();
  const idempotencyRepo = fakeRepo();
  const client = { user: { id: 'bot' }, guilds: { cache: new Map() } } as any;
  const manager = new BaitChannelManager(
    client,
    configRepo,
    logRepo,
    fakeRepo(),
    pendingActionRepo,
    undefined,
    idempotencyRepo,
  );
  managers.push(manager);

  /** Mirror a settings command: write the config, then invalidate the cache. */
  const updateConfig = (patch: Record<string, unknown>) => {
    Object.assign(state.config, patch);
    manager.clearConfigCache(GUILD);
  };
  const loggedActions = () => logRepo.create.mock.calls.map((c: any[]) => c[0].actionTaken);
  return { manager, state, updateConfig, logRepo, pendingActionRepo, idempotencyRepo, loggedActions };
}

async function startGrace(manager: BaitChannelManager, config: any, guild = makeGuild(), id = 'msg-1', score = 60) {
  const member = makeMember(guild);
  const { message, warning } = makeMessage(guild, member, id);
  await (manager as any).initiateGracePeriod(message, config, analysis(score));
  const key = `${guild.id}:${USER}:${id}`;
  const expire = () => (manager as any).resolveGrace(key, 'Grace period expired') as Promise<void>;
  /** What the real timer does: resolve in the member's chain. */
  const timerFires = () =>
    (manager as any).inMemberChain(guild.id, USER, () =>
      (manager as any).resolveGrace(key, 'Grace period expired'),
    ) as Promise<void>;
  return { guild, member, message, warning, key, expire, timerFires };
}

const pending = (manager: BaitChannelManager): Map<string, any> => (manager as any).pendingBans;

afterEach(() => {
  for (const m of managers) {
    for (const p of pending(m).values()) clearTimeout(p.timeoutId);
  }
  managers.length = 0;
});

describe('grace row persistence (#26)', () => {
  test('saves the resolved action, not the column default ban', async () => {
    const h = makeHarness({ actionType: 'timeout' });
    await startGrace(h.manager, h.state.config);
    expect(h.pendingActionRepo.create.mock.calls[0][0].action).toBe('timeout');
  });

  test('kick is saved as the softban the executor will run when the bot can ban', async () => {
    const h = makeHarness({ actionType: 'kick' });
    await startGrace(h.manager, h.state.config);
    expect(h.pendingActionRepo.create.mock.calls[0][0].action).toBe('softban');
  });

  test('test mode saves log-only so nothing reading the row can act for real', async () => {
    const h = makeHarness({ actionType: 'ban', testMode: true });
    await startGrace(h.manager, h.state.config);
    expect(h.pendingActionRepo.create.mock.calls[0][0].action).toBe('log-only');
  });
});

describe('timer expiry uses current state (#31)', () => {
  test('message still there and nothing changed → the configured action runs', async () => {
    const h = makeHarness();
    const g = await startGrace(h.manager, h.state.config);
    await g.expire();
    expect(g.guild.bans.create).toHaveBeenCalledTimes(1);
    expect(h.loggedActions()).toEqual(['ban']);
    expect(g.warning.delete).toHaveBeenCalled();
    expect(pending(h.manager).size).toBe(0);
  });

  test('user deleted their message → deleted-in-time, no action', async () => {
    const h = makeHarness();
    const g = await startGrace(h.manager, h.state.config);
    g.message.fetch = jest.fn(async () => {
      throw new Error('Unknown Message');
    });
    await g.expire();
    expect(g.guild.bans.create).not.toHaveBeenCalled();
    expect(h.loggedActions()).toEqual(['deleted-in-time']);
    expect(g.warning.delete).toHaveBeenCalled();
  });

  test('test mode switched on during the window → dry run only', async () => {
    const h = makeHarness();
    const g = await startGrace(h.manager, h.state.config);
    h.updateConfig({ testMode: true });
    await g.expire();
    expect(g.guild.bans.create).not.toHaveBeenCalled();
    expect(h.loggedActions()).toEqual(['test-ban']);
  });

  test('posted in test mode, test mode switched off → still a dry run (the user was told no action)', async () => {
    const h = makeHarness({ testMode: true });
    const g = await startGrace(h.manager, h.state.config);
    h.updateConfig({ testMode: false });
    await g.expire();
    expect(g.guild.bans.create).not.toHaveBeenCalled();
    expect(h.loggedActions()).toEqual(['test-ban']);
  });

  test('user whitelisted during the window → whitelisted, no action', async () => {
    const h = makeHarness();
    const g = await startGrace(h.manager, h.state.config);
    h.updateConfig({ whitelistedUsers: [USER] });
    await g.expire();
    expect(g.guild.bans.create).not.toHaveBeenCalled();
    expect(g.message.delete).toHaveBeenCalled();
    expect(h.loggedActions()).toEqual(['whitelisted']);
  });

  test('feature disabled during the window → no action and no log row', async () => {
    const h = makeHarness();
    const g = await startGrace(h.manager, h.state.config);
    h.updateConfig({ enabled: false });
    await g.expire();
    expect(g.guild.bans.create).not.toHaveBeenCalled();
    expect(h.loggedActions()).toEqual([]);
    expect(g.warning.delete).toHaveBeenCalled();
    expect(h.pendingActionRepo.delete).toHaveBeenCalledWith({ userId: USER, messageId: 'msg-1', guildId: GUILD });
  });

  test('channel removed from the bait list during the window → no action', async () => {
    const h = makeHarness();
    const g = await startGrace(h.manager, h.state.config);
    h.updateConfig({ channelId: 'other', channelIds: ['other'] });
    await g.expire();
    expect(g.guild.bans.create).not.toHaveBeenCalled();
  });

  test('config unreadable at expiry → no action', async () => {
    const h = makeHarness();
    const g = await startGrace(h.manager, h.state.config);
    (h.state as any).config = null;
    h.manager.clearConfigCache(GUILD);
    await g.expire();
    expect(g.guild.bans.create).not.toHaveBeenCalled();
  });
});

describe('leaving the guild (#11, #26)', () => {
  test("leaving guild B never touches the user's grace timer in guild A", async () => {
    const h = makeHarness();
    const a = await startGrace(h.manager, h.state.config, makeGuild('guild-A'), 'msg-a');
    const b = await startGrace(h.manager, h.state.config, makeGuild('guild-B'), 'msg-b');
    h.manager.clearConfigCache('guild-B');

    await h.manager.resolveGraceOnLeave('guild-B', USER);

    expect(pending(h.manager).has(a.key)).toBe(true);
    expect(pending(h.manager).has(b.key)).toBe(false);
    expect(a.guild.bans.create).not.toHaveBeenCalled();
  });

  test('leave during the window acts now, as a softban for a timeout config', async () => {
    const h = makeHarness({ actionType: 'timeout' });
    const g = await startGrace(h.manager, h.state.config);
    await h.manager.resolveGraceOnLeave(GUILD, USER);
    expect(g.member.timeout).not.toHaveBeenCalled();
    expect(g.guild.bans.create).toHaveBeenCalledTimes(1);
    expect(g.guild.bans.remove).toHaveBeenCalledTimes(1); // softban = ban + unban, never a permanent ban
    expect(pending(h.manager).size).toBe(0);
  });

  test('a softban on leave is recorded as softban and sends no DM naming the timeout or kick', async () => {
    for (const actionType of ['timeout', 'kick']) {
      const h = makeHarness({ actionType, dmBeforeAction: true });
      const g = await startGrace(h.manager, h.state.config);
      await h.manager.resolveGraceOnLeave(GUILD, USER);
      expect(g.guild.bans.remove).toHaveBeenCalledTimes(1);
      expect(g.member.send).not.toHaveBeenCalled();
      expect(h.loggedActions()).toEqual(['softban']);
    }
  });

  test('a softban on leave that fails terminally is titled "Softban FAILED" in the log channel', async () => {
    const h = makeHarness({ actionType: 'timeout', logChannelId: 'log-1' });
    const guild = makeGuild();
    guild.bans.create = jest.fn(async () => {
      throw apiError(50013, 403);
    });
    const logChannel = { send: jest.fn(async () => undefined) };
    guild.channels.fetch = jest.fn(async (id: string) => (id === 'log-1' ? logChannel : null));
    const g = await startGrace(h.manager, h.state.config, guild);
    g.member.roles.cache.size = 1;
    g.member.user.displayAvatarURL = () => 'https://cdn.example/avatar.png';
    g.message.attachments = { size: 0 };

    await h.manager.resolveGraceOnLeave(GUILD, USER);

    expect(h.loggedActions()).toEqual(['failed']);
    const titles = logChannel.send.mock.calls.map((c: any[]) => c[0].embeds[0].data.title.trim());
    expect(titles).toEqual(['Bait Channel Softban FAILED']);
  });

  test('ban list unreadable on leave (5xx, network) → no softban, only logged', async () => {
    const h = makeHarness({ actionType: 'timeout' });
    const guild = makeGuild();
    guild.bans.fetch = jest.fn(async () => {
      throw apiError(0, 503);
    });
    const g = await startGrace(h.manager, h.state.config, guild);
    await h.manager.resolveGraceOnLeave(GUILD, USER);
    expect(guild.bans.create).not.toHaveBeenCalled();
    expect(guild.bans.remove).not.toHaveBeenCalled();
    expect(g.message.delete).toHaveBeenCalled();
    expect(h.loggedActions()).toEqual(['demoted-after-leave']);
  });

  test('banned on the way out (mod or another bot) → no softban, so the ban is never lifted', async () => {
    const h = makeHarness({ actionType: 'kick' });
    const guild = makeGuild(GUILD, { banned: true });
    const g = await startGrace(h.manager, h.state.config, guild);
    await h.manager.resolveGraceOnLeave(GUILD, USER);
    expect(guild.bans.create).not.toHaveBeenCalled();
    expect(guild.bans.remove).not.toHaveBeenCalled();
    expect(g.message.delete).toHaveBeenCalled();
    expect(h.loggedActions()).toEqual(['superseded-by-mod']);
    expect(pending(h.manager).size).toBe(0);
  });

  test('banned with their messages purged → superseded, not counted as complied', async () => {
    const h = makeHarness({ actionType: 'timeout' });
    const guild = makeGuild(GUILD, { banned: true });
    const g = await startGrace(h.manager, h.state.config, guild);
    g.message.fetch = jest.fn(async () => {
      throw new Error('Unknown Message');
    });
    await h.manager.resolveGraceOnLeave(GUILD, USER);
    expect(guild.bans.remove).not.toHaveBeenCalled();
    expect(h.loggedActions()).toEqual(['superseded-by-mod']);
  });

  test('no BanMembers → a kick on leave is only logged, never a ban attempt that must fail', async () => {
    const h = makeHarness({ actionType: 'kick' });
    const guild = makeGuild(GUILD, { canBan: false });
    const g = await startGrace(h.manager, h.state.config, guild);
    await h.manager.resolveGraceOnLeave(GUILD, USER);
    expect(guild.bans.create).not.toHaveBeenCalled();
    expect(g.member.kick).not.toHaveBeenCalled();
    expect(g.message.delete).toHaveBeenCalled();
    expect(h.loggedActions()).toEqual(['demoted-after-leave']);
  });

  test('leave in a test-mode guild → dry run, no ban', async () => {
    const h = makeHarness({ testMode: true });
    const g = await startGrace(h.manager, h.state.config);
    await h.manager.resolveGraceOnLeave(GUILD, USER);
    expect(g.guild.bans.create).not.toHaveBeenCalled();
    expect(h.loggedActions()).toEqual(['test-ban']);
  });

  test('deleted the message, then left → deleted-in-time, no ban', async () => {
    const h = makeHarness();
    const g = await startGrace(h.manager, h.state.config);
    g.message.fetch = jest.fn(async () => {
      throw new Error('Unknown Message');
    });
    await h.manager.resolveGraceOnLeave(GUILD, USER);
    expect(g.guild.bans.create).not.toHaveBeenCalled();
    expect(h.loggedActions()).toEqual(['deleted-in-time']);
  });

  test('a restored entry (no live context) is dropped on leave without acting', async () => {
    const h = makeHarness();
    const key = `${GUILD}:${USER}:msg-r`;
    pending(h.manager).set(key, {
      guildId: GUILD,
      userId: USER,
      messageId: 'msg-r',
      channelId: BAIT,
      timestamp: Date.now(),
      timeoutId: setTimeout(() => {}, 3_600_000),
      suspicionScore: 60,
    });
    await h.manager.resolveGraceOnLeave(GUILD, USER);
    expect(pending(h.manager).has(key)).toBe(false);
    expect(h.loggedActions()).toEqual([]);
  });
});

describe('several bait posts from one user', () => {
  test('a ban ends their other grace periods, so the leave it causes replays nothing', async () => {
    const h = makeHarness();
    const guild = makeGuild();
    const first = await startGrace(h.manager, h.state.config, guild, 'msg-1');
    const second = await startGrace(h.manager, h.state.config, guild, 'msg-2');

    await first.expire();
    await h.manager.resolveGraceOnLeave(GUILD, USER); // the ban's own guildMemberRemove

    expect(guild.bans.create).toHaveBeenCalledTimes(1);
    expect(h.loggedActions()).toEqual(['ban']);
    expect(pending(h.manager).has(second.key)).toBe(false);
    expect(second.warning.delete).toHaveBeenCalled();
  });

  test('a kick-level post acts at its own level; a ban-level post still in its window is never escalated to', async () => {
    const h = makeHarness({ enableEscalation: true }); // 75+ kick, 90+ ban
    const guild = makeGuild();
    const kickLevel = await startGrace(h.manager, h.state.config, guild, 'msg-1', 80);
    const banLevel = await startGrace(h.manager, h.state.config, guild, 'msg-2', 92);

    await kickLevel.expire();

    expect(guild.bans.create).toHaveBeenCalledTimes(1);
    expect(guild.bans.remove).toHaveBeenCalledTimes(1); // a softban, not a permanent ban
    expect(h.loggedActions()).toEqual(['kick']);
    // The softban ended the other grace period: its post is removed and its timer can't ban later.
    expect(pending(h.manager).has(banLevel.key)).toBe(false);
    expect(banLevel.message.delete).toHaveBeenCalledTimes(1);
    expect(banLevel.warning.delete).toHaveBeenCalled();
  });

  test('a post that only times them out leaves their other posts to their own timers', async () => {
    const h = makeHarness({ enableEscalation: true }); // 50+ timeout, 90+ ban
    const guild = makeGuild();
    const timeoutLevel = await startGrace(h.manager, h.state.config, guild, 'msg-1', 60);
    const banLevel = await startGrace(h.manager, h.state.config, guild, 'msg-2', 92);

    await timeoutLevel.expire();
    expect(timeoutLevel.member.timeout).toHaveBeenCalledTimes(1);
    expect(guild.bans.create).not.toHaveBeenCalled();
    expect(pending(h.manager).has(banLevel.key)).toBe(true);

    await banLevel.expire();
    expect(guild.bans.create).toHaveBeenCalledTimes(1);
    expect(guild.bans.remove).not.toHaveBeenCalled();
    expect(h.loggedActions()).toEqual(['timeout', 'ban']);
  });

  test('if the removal fails, their other grace periods stay pending', async () => {
    const h = makeHarness();
    const guild = makeGuild();
    guild.bans.create = jest.fn(async () => {
      throw apiError(50013, 403);
    });
    const first = await startGrace(h.manager, h.state.config, guild, 'msg-1');
    const second = await startGrace(h.manager, h.state.config, guild, 'msg-2');

    await first.expire();

    expect(h.loggedActions()).toEqual(['failed']);
    expect(pending(h.manager).has(second.key)).toBe(true);
    expect(second.warning.delete).not.toHaveBeenCalled();
    expect(second.message.delete).not.toHaveBeenCalled();
  });

  test('a removal that purges nothing (deleteMessageHours 0) still deletes their other posts', async () => {
    const h = makeHarness({ deleteMessageHours: 0 });
    const guild = makeGuild();
    const first = await startGrace(h.manager, h.state.config, guild, 'msg-1');
    const second = await startGrace(h.manager, h.state.config, guild, 'msg-2');

    await first.expire();

    expect(guild.bans.create).toHaveBeenCalledTimes(1);
    expect(second.message.delete).toHaveBeenCalledTimes(1);
    expect(second.warning.delete).toHaveBeenCalled();
  });

  test('an other post the ban already purged is skipped quietly', async () => {
    const h = makeHarness();
    const guild = makeGuild();
    const first = await startGrace(h.manager, h.state.config, guild, 'msg-1');
    const second = await startGrace(h.manager, h.state.config, guild, 'msg-2');
    second.message.delete = jest.fn(async () => {
      throw apiError(10008, 404);
    });

    await first.expire();

    expect(h.loggedActions()).toEqual(['ban']);
    expect(pending(h.manager).size).toBe(0);
    expect(second.warning.delete).toHaveBeenCalled();
  });

  test('timers that fire together act one at a time: a single ban, nothing to undo it', async () => {
    const h = makeHarness();
    const guild = makeGuild();
    const first = await startGrace(h.manager, h.state.config, guild, 'msg-1');
    const second = await startGrace(h.manager, h.state.config, guild, 'msg-2');

    await Promise.all([first.timerFires(), second.timerFires()]);

    expect(guild.bans.create).toHaveBeenCalledTimes(1);
    expect(h.loggedActions()).toEqual(['ban']);
  });

  test('the leave our own softban causes waits for it, then finds nothing left to do', async () => {
    const h = makeHarness({ actionType: 'kick' });
    const guild = makeGuild();
    let releaseBan: () => void = () => {};
    guild.bans.create = jest.fn(
      () =>
        new Promise<void>(resolve => {
          releaseBan = resolve;
        }),
    );
    const first = await startGrace(h.manager, h.state.config, guild, 'msg-1');
    await startGrace(h.manager, h.state.config, guild, 'msg-2');

    const expiring = first.timerFires();
    while (guild.bans.create.mock.calls.length === 0) await new Promise(r => setTimeout(r, 1));
    const leaving = h.manager.resolveGraceOnLeave(GUILD, USER); // fired by the softban's ban step
    releaseBan();
    await Promise.all([expiring, leaving]);

    expect(guild.bans.create).toHaveBeenCalledTimes(1);
    expect(guild.bans.fetch).not.toHaveBeenCalled(); // no entries left by the time the leave ran
    expect(h.loggedActions()).toEqual(['kick']);
    expect(pending(h.manager).size).toBe(0);
  });
});

describe('bot removed from the guild during the window', () => {
  test('the real timer fires without throwing and drops the entry without acting', async () => {
    const h = makeHarness({ gracePeriodSeconds: 0.05 });
    const uncaught: unknown[] = [];
    const onUncaught = (error: unknown) => uncaught.push(error);
    process.on('uncaughtException', onUncaught);
    try {
      const g = await startGrace(h.manager, h.state.config);
      // discord.js drops the guild from the cache on GuildDelete, so the
      // message's guild getter returns null from then on.
      Object.defineProperty(g.message, 'guild', { get: () => null });

      await new Promise(r => setTimeout(r, 150));

      expect(uncaught).toEqual([]);
      expect(g.guild.bans.create).not.toHaveBeenCalled();
      expect(h.loggedActions()).toEqual([]);
      expect(pending(h.manager).size).toBe(0);
    } finally {
      process.off('uncaughtException', onUncaught);
    }
  });
});

describe('cancelPendingAction (#22)', () => {
  test('stops the timer so expiry does nothing, and removes the warning reply', async () => {
    const h = makeHarness();
    const g = await startGrace(h.manager, h.state.config);
    expect(await h.manager.cancelPendingAction(GUILD, USER, 'msg-1')).toBe(true);
    await g.expire();
    expect(g.guild.bans.create).not.toHaveBeenCalled();
    expect(g.warning.delete).toHaveBeenCalledTimes(1);
    expect(pending(h.manager).size).toBe(0);
  });

  test('a cancel that lands while expiry is mid-flight still wins', async () => {
    const h = makeHarness();
    const g = await startGrace(h.manager, h.state.config);
    let releaseFetch: () => void = () => {};
    g.message.fetch = jest.fn(
      () =>
        new Promise(resolve => {
          releaseFetch = () => resolve(g.message);
        }),
    );
    const expiring = g.expire();
    await h.manager.cancelPendingAction(GUILD, USER, 'msg-1');
    releaseFetch();
    await expiring;
    expect(g.guild.bans.create).not.toHaveBeenCalled();
  });

  test('is guild-scoped and returns false when nothing is pending', async () => {
    const h = makeHarness();
    const g = await startGrace(h.manager, h.state.config);
    expect(await h.manager.cancelPendingAction('guild-other', USER, 'msg-1')).toBe(false);
    expect(pending(h.manager).has(g.key)).toBe(true);
  });
});

describe('queued actions reach the retry queue after their log row (review #4)', () => {
  test('the queued log row exists before the retry is enqueued, so the first tick can settle it', async () => {
    const h = makeHarness();
    initRetryQueue({ client: {} as any, pendingActionRepo: fakeRepo(), idempotencyRepo: fakeRepo() });
    const loggedAtEnqueue: string[][] = [];
    const enqueue = jest.spyOn(getRetryQueue()!, 'enqueue').mockImplementation(async () => {
      loggedAtEnqueue.push(h.loggedActions());
    });
    try {
      const g = await startGrace(h.manager, h.state.config);
      g.guild.bans.create = jest.fn(async () => {
        throw apiError(0, 503);
      });
      await g.expire();
      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(loggedAtEnqueue).toEqual([['queued']]);
    } finally {
      stopRetryQueue();
    }
  });
});

describe('test mode never reaches the retry queue', () => {
  test('a queued dry run (idempotency DB down) is not enqueued for a real retry', async () => {
    const h = makeHarness({ testMode: true });
    initRetryQueue({ client: {} as any, pendingActionRepo: fakeRepo(), idempotencyRepo: fakeRepo() });
    const queue = getRetryQueue()!;
    const enqueue = jest.spyOn(queue, 'enqueue');
    try {
      h.idempotencyRepo.save = jest.fn(async () => {
        throw new Error('db down');
      });
      h.idempotencyRepo.findOne = jest.fn(async () => {
        throw new Error('db down');
      });
      const g = await startGrace(h.manager, h.state.config);
      await g.expire();
      expect(h.loggedActions()).toEqual(['queued']);
      expect(enqueue).not.toHaveBeenCalled();
    } finally {
      stopRetryQueue();
    }
  });
});

describe('restart (#29)', () => {
  /** pending_actions rows as they sit in the database across a restart. */
  function row(overrides: Record<string, unknown> = {}): any {
    return {
      id: 1,
      guildId: GUILD,
      userId: USER,
      messageId: 'msg-r',
      channelId: BAIT,
      action: 'ban',
      suspicionScore: 60,
      warningMessageId: 'warn-msg-r',
      attempts: 0,
      deadAt: null,
      createdAt: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() + 3_600_000),
      ...overrides,
    };
  }

  /** Boot a harness on these rows; find honours the attempts / deadAt filter. */
  async function boot(rows: any[], configOverrides: Record<string, unknown> = {}) {
    const h = makeHarness(configOverrides);
    h.pendingActionRepo.find = jest.fn(async ({ where }: any) =>
      rows.filter(r => r.attempts === where.attempts && (where.deadAt?.type !== 'isNull' || r.deadAt === null)),
    );
    const guild = makeGuild();
    const member = makeMember(guild);
    const { message, warning } = makeMessage(guild, member, 'msg-r');
    const channel = {
      isTextBased: () => true,
      messages: {
        fetch: jest.fn(async (id: string) => {
          if (id === message.id && !state.messageGone) return message;
          if (id === warning.id) return warning;
          throw new Error('Unknown Message');
        }),
      },
    };
    const state = { messageGone: false, memberGone: false };
    guild.channels.fetch = jest.fn(async () => channel);
    guild.members.fetch = jest.fn(async () => {
      if (state.memberGone) throw new Error('Unknown Member');
      return member;
    });
    const client = (h.manager as any).client;
    client.guilds.fetch = jest.fn(async () => guild);
    client.guilds.cache.set(GUILD, guild);
    await h.manager.initialize();
    const key = `${GUILD}:${USER}:msg-r`;
    const fire = () =>
      (h.manager as any).inMemberChain(GUILD, USER, () =>
        (h.manager as any).resolveRestored(key, rows[0].action),
      ) as Promise<void>;
    return { ...h, guild, member, message, warning, state, key, fire };
  }

  test('boot leaves retry and dead-letter rows to the retry queue and the dashboard', async () => {
    const r = await boot([
      row(),
      row({ id: 2, messageId: 'msg-retry', attempts: 1, expiresAt: new Date(Date.now() - 1000) }),
      row({ id: 3, messageId: 'msg-dead', attempts: 3, deadAt: new Date(), expiresAt: new Date(Date.now() - 1000) }),
    ]);
    expect([...pending(r.manager).keys()]).toEqual([r.key]);
    expect(r.pendingActionRepo.delete).not.toHaveBeenCalled();
    expect(r.pendingActionRepo.remove).not.toHaveBeenCalled();
  });

  test('a window that closed during the downtime settles on boot: post still there → the action runs', async () => {
    const r = await boot([row({ expiresAt: new Date(Date.now() - 5 * 60_000) })]);
    // The restored timer fires on its own, right away.
    for (let i = 0; i < 100 && pending(r.manager).size > 0; i++) await new Promise(res => setTimeout(res, 10));
    expect(r.guild.bans.create).toHaveBeenCalledTimes(1);
    expect(r.loggedActions()).toEqual(['ban']);
    expect(r.warning.delete).toHaveBeenCalled();
    expect(r.pendingActionRepo.delete).toHaveBeenCalledWith({ userId: USER, messageId: 'msg-r', guildId: GUILD });
  });

  test('post deleted during the downtime → no action; the row and the warning reply are removed', async () => {
    const r = await boot([row()]);
    r.state.messageGone = true;
    await r.fire();
    expect(r.guild.bans.create).not.toHaveBeenCalled();
    expect(pending(r.manager).size).toBe(0);
    expect(r.pendingActionRepo.delete).toHaveBeenCalledWith({ userId: USER, messageId: 'msg-r', guildId: GUILD });
    expect(r.warning.delete).toHaveBeenCalled();
  });

  test('member left during the downtime → no action', async () => {
    const r = await boot([row()]);
    r.state.memberGone = true;
    await r.fire();
    expect(r.guild.bans.create).not.toHaveBeenCalled();
    expect(r.loggedActions()).toEqual([]);
    expect(pending(r.manager).size).toBe(0);
  });

  test('member timed out now (a mod may have acted during the downtime) → no action', async () => {
    const r = await boot([row()]);
    r.member.communicationDisabledUntilTimestamp = Date.now() + 60 * 60_000;
    await r.fire();
    expect(r.guild.bans.create).not.toHaveBeenCalled();
    expect(r.loggedActions()).toEqual([]);
    expect(pending(r.manager).size).toBe(0);
  });

  test('posted in test mode (row saved as log-only) → still a dry run after the restart', async () => {
    const r = await boot([row({ action: 'log-only' })], { actionType: 'ban', testMode: false });
    await r.fire();
    expect(r.guild.bans.create).not.toHaveBeenCalled();
    expect(r.loggedActions()).toEqual(['test-ban']);
  });

  test('test mode switched on during the downtime → dry run', async () => {
    const r = await boot([row()]);
    r.updateConfig({ testMode: true });
    await r.fire();
    expect(r.guild.bans.create).not.toHaveBeenCalled();
    expect(r.loggedActions()).toEqual(['test-ban']);
  });
});

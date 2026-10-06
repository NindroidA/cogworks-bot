/**
 * Bait embed size limits and cross-channel purge scope (cogworks-bot#41).
 *
 * - The detection-reasons field must stay within Discord's 1024-character
 *   field limit however many URLs or keywords matched. Past it, EmbedBuilder
 *   throws: the grace warning (and its timer) or the log embed is lost.
 * - The bot-side purge must not fetch every channel for every action: it
 *   skips channels quiet since the member joined, runs once (not twice after
 *   the kick fallback), and is skipped when our ban's own message deletion
 *   already reaches back past the join.
 *
 * Runs the real executeAction + REST executor against hand-rolled fakes.
 */

import { afterEach, describe, expect, jest, test } from 'bun:test';
import { ChannelType, Collection, SnowflakeUtil } from 'discord.js';
import { BaitChannelManager } from '../../../../src/utils/baitChannel/baitChannelManager';

const GUILD = 'guild-1';
const USER = 'user-1';
const BAIT = 'bait-1';
const HOUR = 3_600_000;

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
    deleteUserMessages: true,
    deleteMessageHours: 24,
    timeoutDurationMinutes: 60,
    logChannelId: null,
    enableRaidMode: false,
    warningMessage: 'This channel is a trap.',
    ...overrides,
  };
}

/** A text channel whose last message was posted `lastAgoMs` ago. */
function makeChannel(id: string, lastAgoMs: number | null): any {
  return {
    id,
    type: ChannelType.GuildText,
    lastMessageId: lastAgoMs === null ? null : SnowflakeUtil.generate({ timestamp: Date.now() - lastAgoMs }).toString(),
    permissionsFor: () => ({ has: () => true }),
    messages: { fetch: jest.fn(async () => new Collection()) },
    bulkDelete: jest.fn(async () => new Collection()),
  };
}

function makeGuild(channels: any[], opts: { canBan?: boolean; logChannel?: any } = {}): any {
  const canBan = opts.canBan ?? true;
  return {
    id: GUILD,
    name: 'Guild',
    ownerId: 'owner-99',
    members: { me: { permissions: { has: () => canBan } } },
    bans: { create: jest.fn(async () => undefined), remove: jest.fn(async () => undefined) },
    channels: {
      cache: new Collection(channels.map(c => [c.id, c])),
      fetch: jest.fn(async () => opts.logChannel ?? null),
    },
  };
}

function makeMember(guild: any, joinedAgoMs: number): any {
  return {
    id: USER,
    guild,
    user: { tag: 'user-1#0001', createdTimestamp: Date.now() - 86_400_000, displayAvatarURL: () => 'https://x/a.png' },
    joinedTimestamp: Date.now() - joinedAgoMs,
    joinedAt: null,
    roles: { cache: { size: 1, find: () => undefined, some: () => false } },
    permissions: { has: () => false },
    send: jest.fn(async () => undefined),
    timeout: jest.fn(async () => undefined),
    kick: jest.fn(async () => undefined),
  };
}

function makeMessage(guild: any, member: any): any {
  const message: any = {
    id: 'msg-1',
    content: 'free nitro',
    channelId: BAIT,
    channel: { name: 'bait' },
    guild,
    member,
    author: { id: USER, bot: false },
    system: false,
    attachments: { size: 0 },
    delete: jest.fn(async () => undefined),
    reply: jest.fn(async () => ({ id: 'warn-1', delete: jest.fn(async () => undefined) })),
  };
  message.fetch = jest.fn(async () => message);
  return message;
}

function fakeRepo(): any {
  return {
    findOne: jest.fn(async () => null),
    find: jest.fn(async () => []),
    create: jest.fn((x: any) => x),
    save: jest.fn(async (x: any) => x),
    delete: jest.fn(async () => ({ affected: 1 })),
    remove: jest.fn(async (x: any) => x),
  };
}

const managers: BaitChannelManager[] = [];

function makeManager(): BaitChannelManager {
  const client = { user: { id: 'bot' }, guilds: { cache: new Map() } } as any;
  const manager = new BaitChannelManager(client, fakeRepo(), fakeRepo(), fakeRepo(), fakeRepo(), undefined, fakeRepo());
  managers.push(manager);
  return manager;
}

afterEach(() => {
  for (const m of managers) {
    for (const p of (m as any).pendingBans.values()) clearTimeout(p.timeoutId);
  }
  managers.length = 0;
});

/** 30 phishing URLs in one reason, plus a long keyword list: ~2,500 characters joined. */
function hugeReasons(): string[] {
  const urls = Array.from({ length: 30 }, (_, i) => `https://free-nitro-giveaway-${i}.example.com/claim`);
  const keywords = Array.from({ length: 40 }, (_, i) => `keyword${i} (w:5)`);
  return [
    'New account (0.1 days old)',
    `Phishing URL detected: ${urls.join(', ')}`,
    `Suspicious keywords: ${keywords.join(', ')}`,
    'Join burst detected (12 joins in 5 min)',
  ];
}

const fieldsOf = (embed: any): { name: string; value: string }[] => embed.toJSON().fields ?? [];

describe('detection reasons field stays within 1024 characters (#34)', () => {
  test('grace warning: reply sent with every reason line, and the timer is armed', async () => {
    const manager = makeManager();
    const guild = makeGuild([]);
    const member = makeMember(guild, 60_000);
    const message = makeMessage(guild, member);
    const analysis = { score: 60, flags: {}, reasons: hugeReasons() } as any;
    expect(analysis.reasons.join('\n').length).toBeGreaterThan(1024);

    await (manager as any).initiateGracePeriod(message, makeConfig(), analysis);

    expect(message.reply).toHaveBeenCalledTimes(1);
    const embed = message.reply.mock.calls[0][0].embeds[0];
    const field = fieldsOf(embed).find(f => f.name.includes('Detection Reasons'))!;
    expect(field.value.length).toBeLessThanOrEqual(1024);
    // Each reason is capped on its own, so the later ones still show.
    expect(field.value).toContain('Join burst detected');
    expect((manager as any).pendingBans.size).toBe(1);
  });

  test('log channel: the embed is sent, not replaced by the owner-DM fallback', async () => {
    const manager = makeManager();
    const logChannel = { send: jest.fn(async () => undefined) };
    const guild = makeGuild([], { logChannel });
    const member = makeMember(guild, 60_000);
    const message = makeMessage(guild, member);
    const analysis = { score: 95, flags: {}, reasons: hugeReasons() } as any;

    await (manager as any).executeAction(
      member,
      message,
      makeConfig({ logChannelId: 'log-1', deleteUserMessages: false }),
      analysis,
      'Instant action mode',
    );

    expect(logChannel.send).toHaveBeenCalledTimes(1);
    const embed = (logChannel.send.mock.calls[0] as any[])[0].embeds[0];
    const field = fieldsOf(embed).find(f => f.name.includes('Detection Flags'))!;
    expect(field.value.length).toBeLessThanOrEqual(1024);
  });
});

describe('cross-channel purge scope (#37)', () => {
  const analysis = () => ({ score: 95, flags: {}, reasons: [] }) as any;

  test("ban: skipped when the ban's own deletion window reaches back past the join", async () => {
    const manager = makeManager();
    const channels = [makeChannel('c1', 1000), makeChannel('c2', 1000)];
    const guild = makeGuild(channels);
    const member = makeMember(guild, 10 * 60_000); // joined 10 minutes ago, window is 24h
    await (manager as any).executeAction(member, makeMessage(guild, member), makeConfig(), analysis(), 'x');

    expect(guild.bans.create).toHaveBeenCalledTimes(1);
    for (const ch of channels) expect(ch.messages.fetch).not.toHaveBeenCalled();
  });

  test('ban: older members still get the sweep, but only channels active since they joined', async () => {
    const manager = makeManager();
    const active = makeChannel('active', HOUR); // last message 1h ago
    const quiet = makeChannel('quiet', 72 * HOUR); // last message 3 days ago
    const unknown = makeChannel('unknown', null); // no last message known: swept
    const guild = makeGuild([active, quiet, unknown]);
    const member = makeMember(guild, 48 * HOUR); // joined 2 days ago, window is 24h
    await (manager as any).executeAction(member, makeMessage(guild, member), makeConfig(), analysis(), 'x');

    expect(active.messages.fetch).toHaveBeenCalledTimes(1);
    expect(unknown.messages.fetch).toHaveBeenCalledTimes(1);
    expect(quiet.messages.fetch).not.toHaveBeenCalled();
  });

  test('timeout: sweeps only channels active since the join', async () => {
    const manager = makeManager();
    const active = makeChannel('active', 1000);
    const quiet = makeChannel('quiet', 2 * HOUR);
    const guild = makeGuild([active, quiet]);
    const member = makeMember(guild, HOUR);
    await (manager as any).executeAction(
      member,
      makeMessage(guild, member),
      makeConfig({ actionType: 'timeout' }),
      analysis(),
      'x',
    );

    expect(member.timeout).toHaveBeenCalledTimes(1);
    expect(active.messages.fetch).toHaveBeenCalledTimes(1);
    expect(quiet.messages.fetch).not.toHaveBeenCalled();
  });

  test('kick fallback (no BanMembers) with deleteUserMessages sweeps once, not twice', async () => {
    const manager = makeManager();
    const channel = makeChannel('c1', 1000);
    const guild = makeGuild([channel], { canBan: false });
    const member = makeMember(guild, HOUR);
    await (manager as any).executeAction(
      member,
      makeMessage(guild, member),
      makeConfig({ actionType: 'kick' }),
      analysis(),
      'x',
    );

    expect(member.kick).toHaveBeenCalledTimes(1);
    expect(channel.messages.fetch).toHaveBeenCalledTimes(1);
  });
});

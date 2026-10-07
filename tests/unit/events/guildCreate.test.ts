/**
 * guildCreate welcome + join webhook (NindroidA/cogworks-bot#41, audit 16).
 *
 * - The welcome goes to the first channel the bot can actually post in
 *   (system channel, then #general/#chat, then the rest) and moves on to the
 *   next one when a send fails.
 * - The guild-join webhook fires whatever happens to the welcome.
 *
 * Strategy: the event's injectable deps replace command registration and the
 * webhook, so nothing touches the DB or the network.
 */

import { describe, expect, jest, test } from 'bun:test';
import { ChannelType, Collection, PermissionFlagsBits } from 'discord.js';
import guildCreateEvent, { welcomeCandidates } from '../../../src/events/guildCreate';

const ME = { id: 'bot-1' };

function channel(id: string, opts: { name?: string; type?: ChannelType; canPost?: boolean; sendFails?: boolean } = {}) {
  const sent: unknown[] = [];
  return {
    id,
    name: opts.name ?? id,
    type: opts.type ?? ChannelType.GuildText,
    sent,
    permissionsFor: (member: unknown) => ({
      has: (perms: bigint[]) =>
        member === ME &&
        opts.canPost !== false &&
        perms.includes(PermissionFlagsBits.SendMessages) &&
        perms.includes(PermissionFlagsBits.EmbedLinks),
    }),
    send: async (payload: unknown) => {
      if (opts.sendFails) throw new Error('50013: Missing Permissions');
      sent.push(payload);
    },
  };
}

function makeGuild(channels: ReturnType<typeof channel>[], systemChannelId?: string) {
  const cache = new Collection(channels.map(c => [c.id, c]));
  return {
    id: 'guild-1',
    name: 'Test Guild',
    memberCount: 42,
    members: { me: ME },
    systemChannel: systemChannelId ? (cache.get(systemChannelId) ?? null) : null,
    channels: { cache },
  } as any;
}

const client = {
  guilds: { cache: { size: 1 } },
  user: { displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' },
} as any;

function deps() {
  return {
    registerGuildCommands: jest.fn(async () => {}),
    notifyGuildJoin: jest.fn(async () => {}),
  };
}

describe('welcomeCandidates (audit 16)', () => {
  test('skips a locked system channel and voice channels, keeps the priority order', () => {
    const guild = makeGuild(
      [
        channel('system', { canPost: false }),
        channel('voice', { type: ChannelType.GuildVoice }),
        channel('random'),
        channel('general'),
      ],
      'system',
    );

    expect(welcomeCandidates(guild).map(c => c.id)).toEqual(['general', 'random']);
  });

  test('the system channel comes first when the bot can post there', () => {
    const guild = makeGuild([channel('random'), channel('chat'), channel('system')], 'system');
    expect(welcomeCandidates(guild).map(c => c.id)).toEqual(['system', 'chat', 'random']);
  });
});

describe('guildCreate (audit 16)', () => {
  test('a failed send moves on to the next channel', async () => {
    const general = channel('general', { sendFails: true });
    const random = channel('random');
    const d = deps();

    await guildCreateEvent.execute(makeGuild([general, random]), client, d);

    expect(general.sent).toHaveLength(0);
    expect(random.sent).toHaveLength(1);
  });

  test('the join webhook fires even when the welcome could not be posted anywhere', async () => {
    const d = deps();

    await guildCreateEvent.execute(makeGuild([channel('general', { sendFails: true })]), client, d);

    expect(d.registerGuildCommands).toHaveBeenCalledWith('guild-1');
    expect(d.notifyGuildJoin).toHaveBeenCalledWith('guild-1', 'Test Guild', 42);
  });
});

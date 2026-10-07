/**
 * Setup auto-create permissions (NindroidA/cogworks-bot#41, audit 109 + 116).
 *
 * - Members' channels created inside a staff-only category get an explicit
 *   @everyone allow, so they don't sync to the category's deny. Panel
 *   channels are read-only for members (the honeypot lets them post).
 * - Staff-only categories and channels keep the bot and the global staff
 *   role in; the closed-ticket archive forums are staff-only.
 * - Announcement channels fall back to text outside Community servers.
 * - @everyone is never given the staff allow.
 * - deleteCreatedChannels removes channels before their categories and
 *   returns the ones it couldn't delete.
 */

import { describe, expect, test } from 'bun:test';
import { ChannelType, Collection, OverwriteType, PermissionFlagsBits } from 'discord.js';
import { createSystemChannels, deleteCreatedChannels } from '../../../../src/utils/setup/channelCreator';
import type { ChannelFormat } from '../../../../src/utils/setup/channelFormatDetector';

const FORMAT: ChannelFormat = { separator: '-', casing: 'lower', emojiPrefix: false, confidence: 0 };
const { ViewChannel, SendMessages, ReadMessageHistory, AddReactions, CreatePublicThreads, SendMessagesInThreads } =
  PermissionFlagsBits;

interface Overwrite {
  id: string;
  type?: OverwriteType;
  allow?: bigint[];
  deny?: bigint[];
}

interface CreateCall {
  name: string;
  type: ChannelType;
  parent?: string;
  permissionOverwrites?: Overwrite[];
}

function makeGuild(
  opts: {
    features?: string[];
    roles?: string[];
    failTypes?: ChannelType[];
    botLacks?: bigint[];
    failDeleteTypes?: ChannelType[];
  } = {},
) {
  const calls: CreateCall[] = [];
  const deleted: string[] = [];
  const cache = new Collection<string, any>();
  let seq = 0;
  const guild: any = {
    id: 'guild-1',
    features: opts.features ?? [],
    roles: { cache: new Collection((opts.roles ?? []).map(id => [id, { id }])) },
    members: { me: { id: 'bot-1', permissions: { has: (perm: bigint) => !opts.botLacks?.includes(perm) } } },
    client: { user: { id: 'bot-1' } },
    channels: {
      cache,
      create: async (options: CreateCall) => {
        if (opts.failTypes?.includes(options.type)) throw new Error('50013: Missing Permissions');
        calls.push(options);
        const channel = {
          id: `ch-${++seq}`,
          type: options.type,
          rawPosition: seq,
          delete: async () => {
            if (opts.failDeleteTypes?.includes(options.type)) throw new Error('50013: Missing Permissions');
            deleted.push(channel.id);
          },
        };
        cache.set(channel.id, channel);
        return channel;
      },
    },
  };
  return { guild, calls, deleted };
}

const byName = (calls: CreateCall[], name: string, type?: ChannelType) =>
  calls.find(c => c.name === name && (type === undefined || c.type === type));
const overwriteFor = (call: CreateCall | undefined, id: string) => call?.permissionOverwrites?.find(o => o.id === id);

describe('createSystemChannels permissions (audit 109)', () => {
  test('the ticket panel channel is open to members inside the staff-only category', async () => {
    const { guild, calls } = makeGuild({ roles: ['staff-1'] });
    const created = await createSystemChannels(guild, 'ticket', FORMAT, undefined, 'staff-1');

    const category = byName(calls, 'tickets', ChannelType.GuildCategory);
    expect(overwriteFor(category, 'guild-1')?.deny).toEqual([ViewChannel]);
    expect(overwriteFor(category, 'staff-1')?.allow).toEqual([ViewChannel]);
    expect(overwriteFor(category, 'bot-1')).toMatchObject({ type: OverwriteType.Member });
    expect(overwriteFor(category, 'bot-1')?.allow).toContain(ViewChannel);

    const panel = byName(calls, 'tickets', ChannelType.GuildText);
    expect(panel?.parent).toBe(created.category);
    expect(overwriteFor(panel, 'guild-1')).toEqual({
      id: 'guild-1',
      type: OverwriteType.Role,
      allow: [ViewChannel, ReadMessageHistory],
      deny: [SendMessages, AddReactions, CreatePublicThreads, SendMessagesInThreads],
    });
    // @everyone can't send there, so the bot gets Send back to post the panel
    expect(overwriteFor(panel, 'bot-1')?.allow).toContain(SendMessages);
  });

  test('the panel only denies what the bot holds (Discord refuses the rest)', async () => {
    const { guild, calls } = makeGuild({ botLacks: [CreatePublicThreads] });
    await createSystemChannels(guild, 'application', FORMAT);

    expect(overwriteFor(byName(calls, 'applications', ChannelType.GuildText), 'guild-1')?.deny).toEqual([
      SendMessages,
      AddReactions,
      SendMessagesInThreads,
    ]);
  });

  test('@everyone is never given the staff allow', async () => {
    const { guild, calls } = makeGuild({ roles: ['guild-1'] });
    await createSystemChannels(guild, 'ticket', FORMAT, undefined, 'guild-1');

    const everyone = byName(calls, 'tickets', ChannelType.GuildCategory)?.permissionOverwrites?.filter(
      o => o.id === 'guild-1',
    );
    expect(everyone).toEqual([{ id: 'guild-1', type: OverwriteType.Role, deny: [ViewChannel] }]);
  });

  test('the archive forum is staff-only, with the staff role and the bot let in', async () => {
    const { guild, calls } = makeGuild({ roles: ['staff-1'] });
    await createSystemChannels(guild, 'application', FORMAT, undefined, 'staff-1');

    const archive = byName(calls, 'application-archive');
    expect(archive?.type).toBe(ChannelType.GuildForum);
    expect(overwriteFor(archive, 'guild-1')?.deny).toEqual([ViewChannel]);
    expect(overwriteFor(archive, 'staff-1')?.allow).toEqual([ViewChannel]);
    expect(overwriteFor(archive, 'bot-1')).toBeDefined();
  });

  test('the honeypot lets members see and post; the bait log stays staff-only', async () => {
    const { guild, calls } = makeGuild();
    await createSystemChannels(guild, 'bait', FORMAT);

    expect(overwriteFor(byName(calls, 'honeypot'), 'guild-1')?.allow).toEqual([ViewChannel, SendMessages]);
    const log = byName(calls, 'bait-logs');
    expect(overwriteFor(log, 'guild-1')?.deny).toEqual([ViewChannel]);
    expect(overwriteFor(log, 'bot-1')).toBeDefined();
  });

  test('a staff role the guild no longer has is left out instead of failing the create', async () => {
    const { guild, calls } = makeGuild({ roles: [] });
    const created = await createSystemChannels(guild, 'ticket', FORMAT, undefined, 'deleted-role');

    expect(Object.keys(created).sort()).toEqual(['archive', 'button', 'category', 'threadCategory']);
    expect(overwriteFor(byName(calls, 'tickets', ChannelType.GuildCategory), 'deleted-role')).toBeUndefined();
  });

  test('channels in a public category keep syncing (no overwrites of their own)', async () => {
    const { guild, calls } = makeGuild();
    await createSystemChannels(guild, 'rules', FORMAT);

    expect(byName(calls, 'rules')?.permissionOverwrites).toBeUndefined();
  });
});

describe('createSystemChannels announcement type (audit 116)', () => {
  test('falls back to a text channel outside a Community server', async () => {
    const { guild, calls } = makeGuild({ features: [] });
    await createSystemChannels(guild, 'announcement', FORMAT);
    expect(byName(calls, 'announcements')?.type).toBe(ChannelType.GuildText);
  });

  test('stays an announcement channel in a Community server', async () => {
    const { guild, calls } = makeGuild({ features: ['COMMUNITY'] });
    await createSystemChannels(guild, 'announcement', FORMAT);
    expect(byName(calls, 'announcements')?.type).toBe(ChannelType.GuildAnnouncement);
  });
});

describe('deleteCreatedChannels (audit 116)', () => {
  test('deletes the channels before their categories', async () => {
    const { guild, deleted } = makeGuild({ failTypes: [ChannelType.GuildForum] });
    const created = await createSystemChannels(guild, 'ticket', FORMAT);
    expect(created.archive).toBeUndefined();

    const left = await deleteCreatedChannels(guild, created);

    expect(left).toEqual([]);
    expect([...deleted].sort()).toEqual(Object.values(created).sort());
    expect(deleted[0]).toBe(created.button);
    expect(deleted.slice(1).sort()).toEqual([created.category, created.threadCategory].sort());
  });

  test('returns the channels it could not delete', async () => {
    const { guild } = makeGuild({ failTypes: [ChannelType.GuildForum], failDeleteTypes: [ChannelType.GuildCategory] });
    const created = await createSystemChannels(guild, 'ticket', FORMAT);

    const left = await deleteCreatedChannels(guild, created);

    expect(left.sort()).toEqual([created.category, created.threadCategory].sort());
  });
});

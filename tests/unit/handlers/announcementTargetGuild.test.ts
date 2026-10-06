/**
 * /announcement send validates the stored defaults against the current server.
 *
 * AnnouncementConfig.defaultChannelId / defaultRoleId can be edited from the
 * dashboard. Before sending, the default channel is resolved through the
 * current server's channel manager and the default role through its role
 * cache; anything that doesn't resolve (deleted, unknown) gets the
 * invalid-channel reply or is left out of the message.
 */

import { describe, expect, jest, test } from 'bun:test';
import { NewsChannel, TextChannel } from 'discord.js';
import { guildDefaultRoleId, resolveTargetChannel } from '../../../src/commands/handlers/announcement/handler';
import { lang } from '../../../src/lang';
import type { AnnouncementConfig } from '../../../src/typeorm/entities/announcement/AnnouncementConfig';

const KNOWN_CHANNEL = '200000000000000001';
const UNKNOWN_CHANNEL = '200000000000000999';
const KNOWN_ROLE = '300000000000000001';
const UNKNOWN_ROLE = '300000000000000999';

const knownChannel = Object.assign(Object.create(TextChannel.prototype), { id: KNOWN_CHANNEL });
const optionNews = Object.assign(Object.create(NewsChannel.prototype), { id: '200000000000000002' });

// The server's channel manager rejects any id it can't resolve
const guild = {
  id: '100000000000000001',
  channels: {
    fetch: jest.fn(async (id: string) => {
      if (id === KNOWN_CHANNEL) return knownChannel;
      throw Object.assign(new Error('Unknown Channel'), { code: 10003 });
    }),
  },
  roles: { cache: new Map([[KNOWN_ROLE, { id: KNOWN_ROLE }]]) },
};

function interaction(optionChannel: unknown = null) {
  return {
    guild,
    deferred: false,
    replied: false,
    options: { getChannel: () => optionChannel },
    reply: jest.fn(async () => undefined),
  } as any;
}

const config = (overrides: Partial<AnnouncementConfig>) =>
  ({ guildId: guild.id, defaultChannelId: KNOWN_CHANNEL, defaultRoleId: null, ...overrides }) as AnnouncementConfig;

describe('resolveTargetChannel', () => {
  test('the stored default channel is used when the server resolves it', async () => {
    const i = interaction();
    expect(await resolveTargetChannel(i, config({}))).toBe(knownChannel);
    expect(i.reply).not.toHaveBeenCalled();
  });

  test('a stored default the server cannot resolve gets the invalid-channel reply', async () => {
    const i = interaction();
    expect(await resolveTargetChannel(i, config({ defaultChannelId: UNKNOWN_CHANNEL }))).toBeNull();
    expect(i.reply.mock.calls[0][0].content).toContain(lang.announcement.setup.invalidChannel);
  });

  test('a blank stored default does not fetch every channel', async () => {
    guild.channels.fetch.mockClear();
    const i = interaction();
    expect(await resolveTargetChannel(i, config({ defaultChannelId: '' }))).toBeNull();
    expect(guild.channels.fetch).not.toHaveBeenCalled();
  });

  test('the channel option wins over the stored default', async () => {
    expect(await resolveTargetChannel(interaction(optionNews), config({ defaultChannelId: UNKNOWN_CHANNEL }))).toBe(
      optionNews,
    );
  });
});

describe('guildDefaultRoleId', () => {
  test('keeps a role the server has', () => {
    expect(guildDefaultRoleId(guild as any, config({ defaultRoleId: KNOWN_ROLE }))).toBe(KNOWN_ROLE);
  });

  test('drops a role the server does not have, so it is neither rendered nor allowed as a mention', () => {
    expect(guildDefaultRoleId(guild as any, config({ defaultRoleId: UNKNOWN_ROLE }))).toBeNull();
  });

  test('no role stays no role', () => {
    expect(guildDefaultRoleId(guild as any, config({ defaultRoleId: null }))).toBeNull();
  });
});

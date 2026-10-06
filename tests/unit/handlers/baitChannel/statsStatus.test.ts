/**
 * /baitchannel stats and status (cogworks-bot#41).
 *
 * - stats counts the actionTaken values executeAction actually stores
 *   ('ban', 'kick', 'softban', 'timeout'); it used to look for 'banned',
 *   'kicked' and 'timed-out', which nothing writes, so those counters read 0.
 * - status caps the whitelist field so a long whitelist doesn't push it past
 *   Discord's 1024-character limit (EmbedBuilder throws, the command errors).
 *
 * Repos come through an AppDataSource.getRepository patch (both handlers
 * resolve the repo per call), restored afterwards.
 */

import { afterAll, beforeAll, describe, expect, jest, test } from 'bun:test';
import { statsHandler } from '../../../../src/commands/handlers/baitChannel/stats';
import { statusHandler } from '../../../../src/commands/handlers/baitChannel/status';
import { AppDataSource } from '../../../../src/typeorm';
import { BaitChannelConfig } from '../../../../src/typeorm/entities/bait/BaitChannelConfig';
import { BaitChannelLog } from '../../../../src/typeorm/entities/bait/BaitChannelLog';

const state: { logs: any[]; config: any } = { logs: [], config: null };
const logRepo = { find: jest.fn(async () => state.logs) };
const configRepo = { findOne: jest.fn(async () => state.config) };

type GetRepo = { getRepository: (e: unknown) => unknown };
let originalGetRepository: GetRepo['getRepository'] | undefined;

beforeAll(() => {
  originalGetRepository = (AppDataSource as unknown as GetRepo).getRepository;
  (AppDataSource as unknown as GetRepo).getRepository = (e: unknown) =>
    e === BaitChannelLog ? logRepo : e === BaitChannelConfig ? configRepo : {};
});

afterAll(() => {
  if (originalGetRepository) (AppDataSource as unknown as GetRepo).getRepository = originalGetRepository;
});

function makeInteraction(): any {
  return {
    guildId: 'g1',
    guild: { channels: { fetch: jest.fn(async () => null) } },
    options: { getInteger: () => null },
    reply: jest.fn(async () => undefined),
    replied: false,
    deferred: false,
  };
}

const fields = (interaction: any): { name: string; value: string }[] =>
  interaction.reply.mock.calls[0][0].embeds[0].toJSON().fields;
const field = (interaction: any, name: string) => fields(interaction).find(f => f.name === name)!;

describe('/baitchannel stats per-action counters (#33)', () => {
  test('counts the stored values: ban, kick (+ softban), timeout', async () => {
    const log = (actionTaken: string) => ({ actionTaken, suspicionScore: 80, username: 'x', overridden: false });
    state.logs = [
      log('ban'),
      log('ban'),
      log('ban'),
      log('kick'),
      log('softban'),
      log('timeout'),
      log('test-ban'),
      log('deleted-in-time'),
    ];
    const interaction = makeInteraction();
    await statsHandler({} as any, interaction);

    expect(field(interaction, 'Total Triggers').value).toBe('8');
    expect(field(interaction, 'Banned').value).toBe('3');
    expect(field(interaction, 'Kicked').value).toBe('2');
    expect(field(interaction, 'Timed Out').value).toBe('1');
    expect(field(interaction, 'Deleted in Time').value).toBe('1');
  });
});

describe('/baitchannel status whitelist field (#36)', () => {
  const snowflake = (i: number) => `1234567890123456${String(i).padStart(3, '0')}`;

  test('a long whitelist is capped with a count, and the reply goes out', async () => {
    state.config = {
      guildId: 'g1',
      enabled: true,
      channelId: 'bait-1',
      channelIds: ['bait-1'],
      actionType: 'ban',
      gracePeriodSeconds: 15,
      enableSmartDetection: false,
      logChannelId: null,
      testMode: false,
      whitelistedRoles: Array.from({ length: 25 }, (_, i) => snowflake(i)),
      whitelistedUsers: Array.from({ length: 100 }, (_, i) => snowflake(i + 100)),
    };
    const interaction = makeInteraction();
    await statusHandler({} as any, interaction);

    expect(interaction.reply).toHaveBeenCalledTimes(1);
    const whitelist = field(interaction, 'Whitelist');
    expect(whitelist.value.length).toBeLessThanOrEqual(1024);
    expect(whitelist.value).toContain('+10 more');
    expect(whitelist.value).toContain('+85 more');
    expect(whitelist.value).toContain(`<@&${snowflake(0)}>`);
  });

  test('a short whitelist is shown in full', async () => {
    state.config = {
      guildId: 'g1',
      enabled: true,
      channelId: 'bait-1',
      channelIds: ['bait-1'],
      actionType: 'ban',
      gracePeriodSeconds: 15,
      enableSmartDetection: false,
      logChannelId: null,
      testMode: false,
      whitelistedRoles: [snowflake(1)],
      whitelistedUsers: [snowflake(2), snowflake(3)],
    };
    const interaction = makeInteraction();
    await statusHandler({} as any, interaction);

    const whitelist = field(interaction, 'Whitelist');
    expect(whitelist.value).toBe(`**Roles:** <@&${snowflake(1)}>\n**Users:** <@${snowflake(2)}>, <@${snowflake(3)}>`);
  });
});

/**
 * /ticket sla stats (v3.16.31).
 *
 * Response times were measured from lastActivityAt, which every message moves,
 * so a user reply after the first staff response made that ticket count as a
 * negative response time. They now run from the ticket's open time (its
 * channel's snowflake), and the date range counts tickets by when they opened.
 */

import { afterAll, beforeAll, expect, jest, test } from 'bun:test';
import { SnowflakeUtil } from 'discord.js';
import { slaStatsHandler } from '../../../../src/commands/handlers/ticket/sla';
import { AppDataSource } from '../../../../src/typeorm';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const channelOpenedAt = (ms: number) => SnowflakeUtil.generate({ timestamp: ms }).toString();

let rows: Record<string, unknown>[] = [];
// Stable object: sla.ts caches its repo through lazyRepo.
const ticketRepo = {
  createQueryBuilder: () => {
    const qb = { where: () => qb, andWhere: () => qb, getMany: async () => rows };
    return qb;
  },
};

type RepoGetter = { getRepository: (entity: { name?: string }) => unknown };
let originalGetRepository: RepoGetter['getRepository'];

beforeAll(() => {
  originalGetRepository = (AppDataSource as unknown as RepoGetter).getRepository;
  (AppDataSource as unknown as RepoGetter).getRepository = entity => {
    if (entity?.name === 'Ticket') return ticketRepo;
    throw new Error(`slaStats test: unexpected repo ${entity?.name}`);
  };
});

afterAll(() => {
  (AppDataSource as unknown as RepoGetter).getRepository = originalGetRepository;
});

test('response time runs from open, and tickets opened before the range are left out', async () => {
  const opened = Date.now() - 2 * DAY;
  rows = [
    // Opened 2 days ago, staff replied after 60 min, the user replied 5 min later
    {
      channelId: channelOpenedAt(opened),
      statusHistory: null,
      lastActivityAt: new Date(opened + 65 * MINUTE),
      firstResponseAt: new Date(opened + 60 * MINUTE),
      slaBreached: false,
    },
    // Opened 40 days ago (outside 30 days) but someone posted yesterday
    {
      channelId: channelOpenedAt(Date.now() - 40 * DAY),
      statusHistory: null,
      lastActivityAt: new Date(Date.now() - DAY),
      firstResponseAt: new Date(Date.now() - 39 * DAY),
      slaBreached: true,
    },
  ];
  const interaction = {
    guildId: 'guild-sla-stats',
    guild: {},
    user: { id: 'admin-1' },
    member: { permissions: { has: () => true } },
    options: { getInteger: () => 30 },
    deferred: false,
    replied: false,
    isRepliable: () => true,
    reply: jest.fn(async () => undefined),
  };

  await slaStatsHandler(interaction as never);

  const embed = (interaction.reply.mock.calls[0] as unknown as [{ embeds: { data: { fields: { value: string }[] } }[] }])[0]
    .embeds[0];
  const [total, avgResponse, compliance, breaches] = embed.data.fields.map(f => f.value);
  expect(total).toBe('1');
  expect(avgResponse).toContain('60');
  expect(compliance).toContain('100');
  expect(breaches).toBe('0');
});

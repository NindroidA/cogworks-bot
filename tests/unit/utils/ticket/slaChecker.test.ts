/**
 * SLA checker rollout guard (v3.16.6): the checker is now scheduled in
 * production. Tickets opened before v3.16.0 started recording
 * firstResponseAt have it NULL even when staff replied, so they must not
 * raise breach alerts; newer tickets past their target still do. A breach
 * channel the bot can't post in is retried each tick without rewriting or
 * re-logging tickets that are already flagged.
 */

import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { type Client, SnowflakeUtil } from 'discord.js';
import { TicketConfig } from '../../../../src/typeorm/entities/ticket/TicketConfig';
import { SCHEDULER_GUARDS } from '../../../../src/utils/constants';
import { checkAndAlertSlaBreaches } from '../../../../src/utils/ticket/slaChecker';

const HOUR = 60 * 60 * 1000;
const channelOpenedAt = (ms: number) => SnowflakeUtil.generate({ timestamp: ms }).toString();
const beforeTracking = SCHEDULER_GUARDS.SLA_TRACKED_SINCE_MS - 30 * 24 * HOUR;
const twoHoursAgo = () => new Date(Date.now() - 2 * HOUR);
const updates: { where: { id: number }; set: Record<string, boolean> }[] = [];
let breachChannelId: string | null = null;
let openTickets: Record<string, unknown>[] = [];
const legacyAndNewTickets = [
  // Idle since before firstResponseAt existed — unknown, not "no reply"
  { id: 1, guildId: 'g1', statusHistory: null, lastActivityAt: new Date(SCHEDULER_GUARDS.SLA_TRACKED_SINCE_MS - HOUR) },
  // Opened two hours ago against a 30-minute target, no staff reply
  { id: 2, guildId: 'g1', statusHistory: null, lastActivityAt: new Date(Date.now() - 2 * HOUR) },
  // Already flagged on an earlier tick, no breach channel: left alone, not rewritten every 5 minutes
  { id: 3, guildId: 'g1', statusHistory: null, lastActivityAt: new Date(Date.now() - 2 * HOUR), slaBreached: true },
  // Opened before tracking (channel snowflake), but the opener posted again later: still legacy
  {
    id: 4,
    guildId: 'g1',
    channelId: channelOpenedAt(beforeTracking),
    statusHistory: null,
    lastActivityAt: new Date(Date.now() - 2 * HOUR),
  },
  // Opened before tracking, first status change after it: still legacy
  {
    id: 5,
    guildId: 'g1',
    channelId: channelOpenedAt(beforeTracking),
    statusHistory: [{ status: 'opened', changedBy: 'u', changedAt: new Date(Date.now() - 2 * HOUR).toISOString() }],
    lastActivityAt: new Date(Date.now() - 2 * HOUR),
  },
  // Channel opened two hours ago, no staff reply
  {
    id: 6,
    guildId: 'g1',
    channelId: channelOpenedAt(Date.now() - 2 * HOUR),
    statusHistory: null,
    lastActivityAt: new Date(Date.now() - 2 * HOUR),
  },
];

let AppDataSource: { getRepository: unknown };
let originalGetRepository: unknown;

beforeAll(async () => {
  AppDataSource = (await import('../../../../src/typeorm')).AppDataSource as unknown as typeof AppDataSource;
  originalGetRepository = AppDataSource.getRepository;
  AppDataSource.getRepository = (entity: unknown) => {
    if (entity === TicketConfig) {
      return {
        find: async () => [
          { guildId: 'g1', slaTargetMinutes: 30, slaPerType: null, slaBreachChannelId: breachChannelId },
        ],
      };
    }
    const qb = { where: () => qb, andWhere: () => qb, getMany: async () => openTickets };
    return {
      createQueryBuilder: () => qb,
      update: async (where: { id: number }, set: Record<string, boolean>) => updates.push({ where, set }),
    };
  };
});

afterAll(() => {
  AppDataSource.getRepository = originalGetRepository;
});

beforeEach(() => {
  updates.length = 0;
  breachChannelId = null;
});

const clientWithBreachChannel = (send: () => Promise<unknown>) =>
  ({ channels: { fetch: async () => ({ send }) } }) as unknown as Client;

test('flags only tickets opened after firstResponseAt tracking began (channel snowflake time when known)', async () => {
  openTickets = legacyAndNewTickets;
  await checkAndAlertSlaBreaches({} as Client);

  expect(updates).toEqual([
    { where: { id: 2, guildId: 'g1' }, set: { slaBreached: true, slaBreachNotified: false } },
    { where: { id: 6, guildId: 'g1' }, set: { slaBreached: true, slaBreachNotified: false } },
  ]);
});

test('a breach channel that rejects the alert: new breaches are flagged once, flagged tickets are not rewritten', async () => {
  breachChannelId = 'c1';
  let sends = 0;
  openTickets = [
    { id: 7, guildId: 'g1', statusHistory: null, lastActivityAt: twoHoursAgo() },
    { id: 8, guildId: 'g1', statusHistory: null, lastActivityAt: twoHoursAgo(), slaBreached: true },
  ];
  await checkAndAlertSlaBreaches(
    clientWithBreachChannel(async () => {
      sends++;
      throw new Error('Missing Permissions');
    }),
  );

  expect(sends).toBe(2);
  expect(updates).toEqual([{ where: { id: 7, guildId: 'g1' }, set: { slaBreached: true, slaBreachNotified: false } }]);
});

test('an already-flagged ticket is marked notified once its alert finally lands', async () => {
  breachChannelId = 'c1';
  openTickets = [{ id: 9, guildId: 'g1', statusHistory: null, lastActivityAt: twoHoursAgo(), slaBreached: true }];
  await checkAndAlertSlaBreaches(clientWithBreachChannel(async () => ({})));

  expect(updates).toEqual([{ where: { id: 9, guildId: 'g1' }, set: { slaBreached: true, slaBreachNotified: true } }]);
});

/**
 * Reminder dedupe (v3.16.6): events the bot created got two identical
 * reminder rows (the command's, plus guildScheduledEventCreate's
 * auto-reminder), and those rows are already in the table. The checker posts
 * one embed per event and reminder minute and marks the repeats sent.
 */

import { afterAll, beforeAll, expect, jest, test } from 'bun:test';
import { type Client, GuildScheduledEventStatus } from 'discord.js';
import { EventConfig } from '../../../../src/typeorm/entities/event/EventConfig';
import { checkAndSendReminders } from '../../../../src/utils/event/reminderChecker';

const MIN = 60_000;
const reminderAt = new Date(Date.now() - 30_000);
const rows = [
  { id: 1, guildId: 'g1', discordEventId: 'e1', reminderAt, sent: false, eventTitle: null },
  // Same event and time: the duplicate row
  { id: 2, guildId: 'g1', discordEventId: 'e1', reminderAt: new Date(reminderAt), sent: false, eventTitle: null },
  // Same event, a different reminder (e.g. /event remind minutes:15): still posted
  {
    id: 3,
    guildId: 'g1',
    discordEventId: 'e1',
    reminderAt: new Date(reminderAt.getTime() - 15 * MIN),
    sent: false,
    eventTitle: null,
  },
];
const saved: number[] = [];
const send = jest.fn(async () => ({}));

const client = {
  channels: { fetch: async () => ({ send }) },
  guilds: {
    cache: {
      get: () => ({
        scheduledEvents: {
          fetch: async () => ({
            name: 'Game night',
            description: null,
            status: GuildScheduledEventStatus.Scheduled,
            scheduledStartAt: new Date(Date.now() + 10 * MIN),
            scheduledStartTimestamp: Date.now() + 10 * MIN,
          }),
        },
      }),
    },
  },
} as unknown as Client;

let AppDataSource: { getRepository: unknown };
let originalGetRepository: unknown;

beforeAll(async () => {
  AppDataSource = (await import('../../../../src/typeorm')).AppDataSource as unknown as typeof AppDataSource;
  originalGetRepository = AppDataSource.getRepository;
  AppDataSource.getRepository = (entity: unknown) => {
    if (entity === EventConfig) {
      return { findOneBy: async () => ({ guildId: 'g1', enabled: true, reminderChannelId: 'c1' }) };
    }
    return {
      find: async () => rows,
      save: async (row: (typeof rows)[number]) => {
        saved.push(row.id);
        return row;
      },
    };
  };
});

afterAll(() => {
  AppDataSource.getRepository = originalGetRepository;
});

test('two rows for the same event and time post one reminder; both are marked sent', async () => {
  await checkAndSendReminders(client);

  expect(send).toHaveBeenCalledTimes(2); // row 1, and row 3's distinct reminder
  expect(rows.every(r => r.sent)).toBe(true);
  expect(saved.sort()).toEqual([1, 2, 3]);
});

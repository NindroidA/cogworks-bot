/**
 * guildScheduledEventCreate auto-reminder (v3.16.6): Discord sends this event
 * for events the bot creates too, and those paths (/event create, templates,
 * recurring) already add their own reminder. Only events created by someone
 * else get the auto-reminder here.
 */

import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import type { Client, GuildScheduledEvent } from 'discord.js';
import { guildScheduledEventCreate } from '../../../src/events/scheduledEventHandlers';
import { EventConfig } from '../../../src/typeorm/entities/event/EventConfig';

const BOT_ID = '100000000000000001';
const client = { user: { id: BOT_ID } } as unknown as Client;
let saved: unknown[] = [];

const eventBy = (creatorId: string | null) =>
  ({
    id: '200000000000000001',
    guildId: 'g1',
    name: 'Game night',
    creatorId,
    scheduledStartAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
  }) as unknown as GuildScheduledEvent;

let AppDataSource: { getRepository: unknown };
let originalGetRepository: unknown;

beforeAll(async () => {
  AppDataSource = (await import('../../../src/typeorm')).AppDataSource as unknown as typeof AppDataSource;
  originalGetRepository = AppDataSource.getRepository;
  AppDataSource.getRepository = (entity: unknown) => {
    if (entity === EventConfig) {
      return {
        findOneBy: async () => ({ guildId: 'g1', enabled: true, reminderChannelId: 'c1', defaultReminderMinutes: 30 }),
      };
    }
    return {
      create: (row: unknown) => row,
      save: async (row: unknown) => {
        saved.push(row);
        return row;
      },
    };
  };
});

beforeEach(() => {
  saved = [];
});

afterAll(() => {
  AppDataSource.getRepository = originalGetRepository;
});

test("skips the auto-reminder for the bot's own events", async () => {
  await guildScheduledEventCreate.execute(eventBy(BOT_ID), client);
  expect(saved).toHaveLength(0);
});

test('adds the auto-reminder for events created in the Discord UI', async () => {
  await guildScheduledEventCreate.execute(eventBy('300000000000000001'), client);
  await guildScheduledEventCreate.execute(eventBy(null), client);
  expect(saved).toHaveLength(2);
});

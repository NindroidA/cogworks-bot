/**
 * Scheduled-event gateway handlers.
 *
 * guildScheduledEventCreate auto-reminder (v3.16.6): Discord sends this event
 * for events the bot creates too, and those paths (/event create, templates,
 * recurring) already add their own reminder. Only events created by someone
 * else get the auto-reminder here.
 *
 * guildScheduledEventUpdate (v3.16.32): a new start time moves every pending
 * reminder (custom /event remind ones too) instead of replacing them with the
 * default; a completed event only continues a recurring chain when the bot
 * created it, and voice/stage occurrences reuse the last occurrence's channel.
 *
 * The repo fakes are built once (lazyRepo caches the first repository it gets)
 * and read the per-test state below.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  type Client,
  type GuildScheduledEvent,
  GuildScheduledEventEntityType,
  GuildScheduledEventStatus,
} from 'discord.js';
import { guildScheduledEventCreate, guildScheduledEventUpdate } from '../../../src/events/scheduledEventHandlers';
import { EventConfig } from '../../../src/typeorm/entities/event/EventConfig';
import { EventTemplate } from '../../../src/typeorm/entities/event/EventTemplate';

const BOT_ID = '100000000000000001';
const HUMAN_ID = '300000000000000001';
const MIN = 60_000;
let saved: unknown[] = [];
let removed: unknown[] = [];
let pending: { reminderAt: Date; label: string }[] = [];
let templates: Partial<EventTemplate>[] = [];
let created: Record<string, unknown>[] = [];

const client = {
  user: { id: BOT_ID },
  guilds: {
    cache: {
      get: () => ({
        scheduledEvents: {
          create: async (data: Record<string, unknown>) => {
            created.push(data);
            return { id: '200000000000000099' };
          },
        },
      }),
    },
  },
} as unknown as Client;

const eventBy = (creatorId: string | null, overrides: Record<string, unknown> = {}) =>
  ({
    id: '200000000000000001',
    guildId: 'g1',
    name: 'Game night',
    creatorId,
    scheduledStartAt: new Date(Date.now() + 2 * 60 * MIN),
    ...overrides,
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
    if (entity === EventTemplate) return { find: async () => templates };
    return {
      create: (row: unknown) => row,
      save: async (row: unknown) => {
        saved.push(...(Array.isArray(row) ? row : [row]));
        return row;
      },
      find: async () => pending,
      remove: async (rows: unknown[]) => {
        removed.push(...rows);
        return rows;
      },
      delete: async () => ({ affected: 0 }),
    };
  };
});

beforeEach(() => {
  saved = [];
  removed = [];
  pending = [];
  templates = [];
  created = [];
});

afterAll(() => {
  AppDataSource.getRepository = originalGetRepository;
});

describe('guildScheduledEventCreate', () => {
  test("skips the auto-reminder for the bot's own events", async () => {
    await guildScheduledEventCreate.execute(eventBy(BOT_ID), client);
    expect(saved).toHaveLength(0);
  });

  test('adds the auto-reminder for events created in the Discord UI', async () => {
    await guildScheduledEventCreate.execute(eventBy(HUMAN_ID), client);
    await guildScheduledEventCreate.execute(eventBy(null), client);
    expect(saved).toHaveLength(2);
  });
});

describe('guildScheduledEventUpdate: rescheduling', () => {
  const at = (minutesFromNow: number) => new Date(Date.now() + minutesFromNow * MIN);
  const reschedule = (oldStartMin: number, newStartMin: number) =>
    guildScheduledEventUpdate.execute(
      eventBy(BOT_ID, { scheduledStartAt: at(oldStartMin) }),
      eventBy(BOT_ID, { scheduledStartAt: at(newStartMin), status: GuildScheduledEventStatus.Scheduled }),
      client,
    );

  test('moves the default and custom reminders by the same amount', async () => {
    const start = at(120);
    pending = [
      { label: 'default', reminderAt: new Date(start.getTime() - 30 * MIN) },
      { label: 'custom', reminderAt: new Date(start.getTime() - 60 * MIN) },
    ];
    const before = pending.map(r => r.reminderAt.getTime());

    await reschedule(120, 180);

    expect(saved).toHaveLength(2); // both moved, no extra default added
    expect(pending.map((r, i) => r.reminderAt.getTime() - before[i])).toEqual([60 * MIN, 60 * MIN]);
    expect(removed).toHaveLength(0);
  });

  test('drops reminders that now fall in the past and keeps the rest', async () => {
    const start = at(120);
    const defaultReminder = { label: 'default', reminderAt: new Date(start.getTime() - 30 * MIN) };
    const custom = { label: 'custom', reminderAt: new Date(start.getTime() - 60 * MIN) };
    pending = [defaultReminder, custom];

    await reschedule(120, 40); // 80 minutes earlier: the custom one would be 20 minutes ago

    expect(removed).toEqual([custom]);
    expect(saved).toEqual([defaultReminder]);
  });

  test('adds the default reminder when the event had none pending', async () => {
    await reschedule(20, 120);
    expect(saved).toHaveLength(1);
    expect((saved[0] as { reminderAt: Date }).reminderAt.getTime()).toBeGreaterThan(Date.now() + 80 * MIN);
  });
});

describe('guildScheduledEventUpdate: recurring chains', () => {
  const complete = (creatorId: string | null, overrides: Record<string, unknown> = {}) =>
    guildScheduledEventUpdate.execute(
      null,
      eventBy(creatorId, { status: GuildScheduledEventStatus.Completed, scheduledStartAt: new Date(), ...overrides }),
      client,
    );
  const weekly = (entityType: string) => ({
    name: 'game-night',
    title: 'Game night',
    isRecurring: true,
    recurringPattern: 'weekly' as const,
    entityType: entityType as EventTemplate['entityType'],
    defaultDurationMinutes: 60,
    location: 'Discord',
  });

  test('an event made by hand with the same title does not start a chain', async () => {
    templates = [weekly('external')];
    await complete(HUMAN_ID);
    expect(created).toHaveLength(0);
  });

  test("the bot's own occurrence creates the next one", async () => {
    templates = [weekly('external')];
    await complete(BOT_ID);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ name: 'Game night', entityMetadata: { location: 'Discord' } });
  });

  test('a voice occurrence passes its channel on to the next one', async () => {
    templates = [weekly('voice')];
    await complete(BOT_ID, { channelId: '400000000000000001', entityType: GuildScheduledEventEntityType.Voice });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      channel: '400000000000000001',
      entityType: GuildScheduledEventEntityType.Voice,
    });
  });

  test('a voice occurrence with no channel stops instead of failing on Discord', async () => {
    templates = [weekly('stage')];
    await complete(BOT_ID, { channelId: null, entityType: GuildScheduledEventEntityType.StageInstance });
    expect(created).toHaveLength(0);
  });
});

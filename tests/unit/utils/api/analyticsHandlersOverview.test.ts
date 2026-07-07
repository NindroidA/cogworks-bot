/**
 * analyticsHandlers /overview Behavioral Tests
 *
 * Companion to analyticsHandlers.test.ts (which tests pure helpers).
 * Exercises the GET /analytics/overview route registered by
 * registerAnalyticsHandlers, using the same AppDataSource.getRepository
 * runtime patch as the other API handler tests.
 *
 * Coverage:
 *   - Aggregates current-window snapshots into the expected summary fields
 *   - Computes pctChange comparedToPrevious vs the prior window
 *   - Aggregates topChannels across days, sorts by message count, caps at 5
 *   - Empty current window returns zeroes (no 404)
 *   - Respects ?days=N override and clamps oversize requests
 *   - Rejects bad ?days= values with 400
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, test } from 'bun:test';
import type { Client } from 'discord.js';

interface AnalyticsRepoState {
  /** Returned in order: first call (current window), second call (previous window). */
  findResults: any[][];
}

const repoState: AnalyticsRepoState = { findResults: [] };

const analyticsRepo = {
  find: jest.fn(async () => {
    if (repoState.findResults.length === 0) return [];
    return repoState.findResults.shift();
  }),
};

let registerAnalyticsHandlers: typeof import('../../../../src/utils/api/handlers/analyticsHandlers').registerAnalyticsHandlers;
let routes: Map<string, any>;
const fakeClient = {} as Client;
let originalGetRepository: ((entity: unknown) => unknown) | undefined;

beforeAll(async () => {
  const { AppDataSource } = await import('../../../../src/typeorm');
  const { AnalyticsSnapshot } = await import('../../../../src/typeorm/entities/analytics/AnalyticsSnapshot');
  // Capture so afterAll can restore. Bun shares module state across test files.
  originalGetRepository = (AppDataSource as unknown as { getRepository: (e: unknown) => unknown }).getRepository;
  (AppDataSource as unknown as { getRepository: (e: unknown) => unknown }).getRepository = entity =>
    entity === AnalyticsSnapshot
      ? analyticsRepo
      : (() => {
          throw new Error(`Unmocked entity: ${(entity as { name?: string }).name}`);
        })();
  const sut = await import('../../../../src/utils/api/handlers/analyticsHandlers');
  registerAnalyticsHandlers = sut.registerAnalyticsHandlers;
});

afterAll(async () => {
  if (originalGetRepository) {
    const { AppDataSource } = await import('../../../../src/typeorm');
    (AppDataSource as unknown as { getRepository: (e: unknown) => unknown }).getRepository = originalGetRepository;
  }
});

beforeEach(() => {
  repoState.findResults = [];
  analyticsRepo.find.mockClear();

  routes = new Map();
  registerAnalyticsHandlers(fakeClient, routes);
});

afterEach(() => {
  jest.clearAllMocks();
});

function getOverview() {
  const handler = routes.get('GET /analytics/overview');
  if (!handler) throw new Error('GET /analytics/overview not registered');
  return handler;
}

function snap(over: Record<string, unknown>): any {
  return {
    messageCount: 0,
    activeMembers: 0,
    memberJoined: 0,
    memberLeft: 0,
    voiceMinutes: 0,
    topChannels: [],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /analytics/overview', () => {
  test('aggregates current window + computes pctChange vs previous window', async () => {
    repoState.findResults = [
      // current window — 3 days
      [
        snap({
          messageCount: 100,
          activeMembers: 10,
          memberJoined: 2,
          memberLeft: 1,
          voiceMinutes: 30,
        }),
        snap({
          messageCount: 80,
          activeMembers: 8,
          memberJoined: 1,
          memberLeft: 0,
          voiceMinutes: 45,
        }),
        snap({
          messageCount: 120,
          activeMembers: 12,
          memberJoined: 3,
          memberLeft: 2,
          voiceMinutes: 25,
        }),
      ],
      // previous window — totals are roughly half
      [
        snap({
          messageCount: 50,
          activeMembers: 5,
          memberJoined: 1,
          memberLeft: 0,
          voiceMinutes: 20,
        }),
        snap({
          messageCount: 100,
          activeMembers: 10,
          memberJoined: 2,
          memberLeft: 2,
          voiceMinutes: 30,
        }),
      ],
    ];

    const result = await getOverview()('guild-1', {}, '/analytics/overview');

    expect(result.period).toBe('7d');
    expect(result.messages).toBe(300);
    expect(result.activeMembers).toBe(30);
    expect(result.joins).toBe(6);
    expect(result.leaves).toBe(3);
    expect(result.voiceMinutes).toBe(100);
    // pctChange: messages 300 vs 150 = +100%
    expect(result.comparedToPrevious.messages).toBe('+100%');
    // joins 6 vs 3 = +100%
    expect(result.comparedToPrevious.joins).toBe('+100%');
  });

  test('aggregates topChannels across days, sorts by total messages, caps at 5', async () => {
    repoState.findResults = [
      [
        snap({
          topChannels: [
            { channelId: 'c-a', name: 'channel-a', count: 50, uniqueUsers: 10 },
            { channelId: 'c-b', name: 'channel-b', count: 30, uniqueUsers: 6 },
          ],
        }),
        snap({
          topChannels: [
            { channelId: 'c-a', name: 'channel-a', count: 25, uniqueUsers: 8 }, // accumulates with day 1
            { channelId: 'c-c', name: 'channel-c', count: 100, uniqueUsers: 40 },
            { channelId: 'c-d', name: 'channel-d', count: 10, uniqueUsers: 4 },
            { channelId: 'c-e', name: 'channel-e', count: 5, uniqueUsers: 2 },
            { channelId: 'c-f', name: 'channel-f', count: 1, uniqueUsers: 1 }, // 6th channel — gets dropped
          ],
        }),
      ],
      [], // previous: empty
    ];

    const result = await getOverview()('guild-1', {}, '/analytics/overview');

    expect(result.topChannels).toHaveLength(5);
    // c-c=100, c-a=75 (50+25), c-b=30, c-d=10, c-e=5; c-f=1 is dropped.
    // uniqueUsers = SUM of daily uniques (over-counts multi-day users by design).
    expect(result.topChannels[0]).toEqual({
      channelId: 'c-c',
      channelName: 'channel-c',
      messages: 100,
      uniqueUsers: 40,
    });
    expect(result.topChannels[1]).toEqual({
      channelId: 'c-a',
      channelName: 'channel-a',
      messages: 75,
      uniqueUsers: 18,
    });
    expect(result.topChannels[4]).toEqual({
      channelId: 'c-e',
      channelName: 'channel-e',
      messages: 5,
      uniqueUsers: 2,
    });
  });

  test('empty current window returns zeroes (no 404)', async () => {
    repoState.findResults = [[], []];

    const result = await getOverview()('guild-1', {}, '/analytics/overview');

    expect(result.messages).toBe(0);
    expect(result.activeMembers).toBe(0);
    expect(result.topChannels).toEqual([]);
    // pctChange when both sides are zero → "0%"
    expect(result.comparedToPrevious.messages).toBe('0%');
  });

  test('zero previous + non-zero current → em-dash (avoids divide-by-zero)', async () => {
    repoState.findResults = [
      [snap({ messageCount: 50 })],
      [], // previous empty → 0
    ];

    const result = await getOverview()('guild-1', {}, '/analytics/overview');

    expect(result.messages).toBe(50);
    expect(result.comparedToPrevious.messages).toBe('—');
  });

  test('respects ?days=14 override and reflects it in the response period', async () => {
    repoState.findResults = [[snap({ messageCount: 10 })], []];

    const result = await getOverview()('guild-1', {}, '/analytics/overview?days=14');

    expect(result.period).toBe('14d');
  });

  test('clamps ?days= above MAX_RANGE_DAYS (365)', async () => {
    repoState.findResults = [[], []];

    const result = await getOverview()('guild-1', {}, '/analytics/overview?days=10000');

    expect(result.period).toBe('365d');
  });

  test('rejects ?days=0 with 400', async () => {
    await expect(getOverview()('guild-1', {}, '/analytics/overview?days=0')).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  test('rejects ?days=abc with 400', async () => {
    await expect(getOverview()('guild-1', {}, '/analytics/overview?days=abc')).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});

// ---------------------------------------------------------------------------
// GET /analytics/channels — per-channel uniqueUsers (v3.16.2)
// ---------------------------------------------------------------------------

function getChannels() {
  const handler = routes.get('GET /analytics/channels');
  if (!handler) throw new Error('GET /analytics/channels not registered');
  return handler;
}

describe('GET /analytics/channels', () => {
  test('aggregates messages and uniqueUsers per channel across the window', async () => {
    repoState.findResults = [
      [
        snap({
          topChannels: [
            { channelId: 'c-a', name: 'channel-a', count: 50, uniqueUsers: 10 },
            { channelId: 'c-b', name: 'channel-b', count: 30, uniqueUsers: 6 },
          ],
        }),
        snap({
          topChannels: [{ channelId: 'c-a', name: 'channel-a', count: 25, uniqueUsers: 8 }],
        }),
      ],
    ];

    const result = await getChannels()('guild-1', {}, '/analytics/channels');

    // c-a: 75 messages, 18 uniques (SUM of daily); sorted by messages desc.
    expect(result.channels[0]).toEqual({
      channelId: 'c-a',
      channelName: 'channel-a',
      messages: 75,
      uniqueUsers: 18,
    });
    expect(result.channels[1]).toEqual({
      channelId: 'c-b',
      channelName: 'channel-b',
      messages: 30,
      uniqueUsers: 6,
    });
  });

  test('mixed old/new rows: pre-v3.16.2 rows (no uniqueUsers) count as 0', async () => {
    repoState.findResults = [
      [
        // Old row written before v3.16.2 — topChannels entries lack uniqueUsers.
        snap({ topChannels: [{ channelId: 'c-a', name: 'channel-a', count: 40 }] }),
        // New row carries uniqueUsers.
        snap({
          topChannels: [{ channelId: 'c-a', name: 'channel-a', count: 10, uniqueUsers: 5 }],
        }),
      ],
    ];

    const result = await getChannels()('guild-1', {}, '/analytics/channels');

    // messages 50 (40+10); uniqueUsers 5 (0 from the old row + 5 from the new).
    expect(result.channels[0]).toEqual({
      channelId: 'c-a',
      channelName: 'channel-a',
      messages: 50,
      uniqueUsers: 5,
    });
  });

  test('no snapshots → empty channels list (no 404)', async () => {
    repoState.findResults = [[]];
    const result = await getChannels()('guild-1', {}, '/analytics/channels');
    expect(result.channels).toEqual([]);
  });
});

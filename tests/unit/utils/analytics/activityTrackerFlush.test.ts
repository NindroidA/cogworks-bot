/**
 * ActivityTracker flush behavior (v3.16.2) — per-channel uniqueUsers.
 *
 * The shallow in-memory tests in activityTracker.test.ts can't read the
 * private counters, so the dedup/cap logic and its persistence into
 * AnalyticsSnapshot.topChannels are verified here by patching
 * AppDataSource.getRepository (the same seam the API-handler suites use) and
 * inspecting the upserted snapshot.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from 'bun:test';
import { MAX } from '../../../../src/utils/constants';

interface SnapshotRepoState {
  findOneByResult: any;
  saved: any[];
}
const repoState: SnapshotRepoState = { findOneByResult: null, saved: [] };

const analyticsRepo = {
  findOneBy: jest.fn(async () => repoState.findOneByResult),
  create: jest.fn((obj: any) => obj),
  save: jest.fn(async (entity: any) => {
    repoState.saved.push(entity);
    return entity;
  }),
};

let activityTracker: typeof import('../../../../src/utils/analytics/activityTracker').activityTracker;
let originalGetRepository: ((entity: unknown) => unknown) | undefined;
let guildSeq = 0;

beforeAll(async () => {
  const { AppDataSource } = await import('../../../../src/typeorm');
  originalGetRepository = (AppDataSource as unknown as { getRepository: (e: unknown) => unknown }).getRepository;
  (AppDataSource as unknown as { getRepository: (e: unknown) => unknown }).getRepository = () => analyticsRepo;
  activityTracker = (await import('../../../../src/utils/analytics/activityTracker')).activityTracker;
});

afterAll(async () => {
  if (originalGetRepository) {
    const { AppDataSource } = await import('../../../../src/typeorm');
    (AppDataSource as unknown as { getRepository: (e: unknown) => unknown }).getRepository = originalGetRepository;
  }
});

beforeEach(() => {
  repoState.findOneByResult = null;
  repoState.saved = [];
  analyticsRepo.findOneBy.mockClear();
  analyticsRepo.create.mockClear();
  analyticsRepo.save.mockClear();
  guildSeq++;
});

/** Unique guild id per test — the tracker is a process singleton. */
function gid(): string {
  return `flush-guild-${guildSeq}-${process.pid}`;
}

/** topChannels of the single saved snapshot, keyed by channelId. */
function savedChannels(): Record<string, { count: number; uniqueUsers: number }> {
  expect(repoState.saved).toHaveLength(1);
  const rows = repoState.saved[0].topChannels as { channelId: string; count: number; uniqueUsers: number }[];
  return Object.fromEntries(rows.map(r => [r.channelId, { count: r.count, uniqueUsers: r.uniqueUsers }]));
}

describe('activityTracker flush — per-channel uniqueUsers', () => {
  test('dedups authors per channel: repeated author counts once toward uniqueUsers', async () => {
    const guildId = gid();
    activityTracker.recordMessage(guildId, 'ch1', 'general', 'user1');
    activityTracker.recordMessage(guildId, 'ch1', 'general', 'user2');
    activityTracker.recordMessage(guildId, 'ch1', 'general', 'user1'); // dup author
    activityTracker.recordMessage(guildId, 'ch2', 'help', 'user3');

    await activityTracker.flushSnapshot(guildId, 100);

    const channels = savedChannels();
    expect(channels.ch1).toEqual({ count: 3, uniqueUsers: 2 }); // 3 msgs, 2 distinct authors
    expect(channels.ch2).toEqual({ count: 1, uniqueUsers: 1 });
  });

  test('uniqueUsers saturates at MAX.ANALYTICS_CHANNEL_UNIQUE_USERS', async () => {
    const guildId = gid();
    const overCap = MAX.ANALYTICS_CHANNEL_UNIQUE_USERS + 50;
    for (let i = 0; i < overCap; i++) {
      activityTracker.recordMessage(guildId, 'ch1', 'general', `user-${i}`);
    }

    await activityTracker.flushSnapshot(guildId, 100);

    const channels = savedChannels();
    // Message count is uncapped; the unique-author set saturates at the cap.
    expect(channels.ch1.count).toBe(overCap);
    expect(channels.ch1.uniqueUsers).toBe(MAX.ANALYTICS_CHANNEL_UNIQUE_USERS);
  });

  test('flush clears the in-memory counter after persisting the snapshot', async () => {
    const guildId = gid();
    activityTracker.recordMessage(guildId, 'ch1', 'general', 'user1');
    await activityTracker.flushSnapshot(guildId, 100);
    expect(activityTracker.hasCounters(guildId)).toBe(false);
  });
});

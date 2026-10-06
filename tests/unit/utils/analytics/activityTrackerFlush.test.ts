/**
 * ActivityTracker flush behavior (v3.16.2) — per-channel uniqueUsers.
 *
 * The shallow in-memory tests in activityTracker.test.ts can't read the
 * private counters, so the dedup/cap logic and its persistence into
 * AnalyticsSnapshot.topChannels are verified here by patching
 * AppDataSource.getRepository (the same seam the API-handler suites use) and
 * inspecting the upserted snapshot.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, setSystemTime, test } from 'bun:test';
import { format } from 'mysql2';
import { DateUtils } from 'typeorm/util/DateUtils';
import { MAX } from '../../../../src/utils/constants';

interface SnapshotRepoState {
  findOneByResult: any;
  saved: any[];
}
const repoState: SnapshotRepoState = { findOneByResult: null, saved: [] };

const analyticsRepo = {
  findOneBy: jest.fn(async (_where: any) => repoState.findOneByResult),
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

describe('activityTracker flushAll — midnight boundary + allow-list (v3.16.7)', () => {
  afterEach(() => {
    setSystemTime();
  });

  test('the midnight flush persists the day that just ended, not an empty new day', async () => {
    const guildId = gid();
    setSystemTime(new Date('2026-10-04T23:59:00Z'));
    for (let i = 0; i < 5; i++) activityTracker.recordMessage(guildId, 'ch1', 'general', `user-${i}`);
    setSystemTime(new Date('2026-10-05T00:00:00.005Z'));

    await activityTracker.flushAll(new Map([[guildId, 100]]));

    const rows = repoState.saved.filter(r => r.guildId === guildId);
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe('2026-10-04');
    expect(rows[0].messageCount).toBe(5);
    expect(rows[0].activeMembers).toBe(5);
    expect(rows[0].memberCount).toBe(100);
    expect(activityTracker.hasCounters(guildId)).toBe(false);
  });

  test('guilds missing from the allow-list (purged, or never opted in) are dropped, never written', async () => {
    const enabled = gid();
    const purged = `${gid()}-purged`;
    activityTracker.recordMessage(enabled, 'ch1', 'general', 'user1');
    activityTracker.recordMessage(purged, 'ch1', 'general', 'user1');

    await activityTracker.flushAll(new Map([[enabled, 10]]));

    expect(repoState.saved.map(r => r.guildId)).toEqual([enabled]);
    expect(activityTracker.hasCounters(purged)).toBe(false);
  });

  test('a second flush of the same day (shutdown, then midnight) merges into the stored row', async () => {
    const guildId = gid();
    const stored = new Array(24).fill(0);
    stored[3] = 10;
    repoState.findOneByResult = {
      guildId,
      memberCount: 90,
      memberJoined: 0,
      memberLeft: 0,
      messageCount: 10,
      activeMembers: 8,
      voiceMinutes: 0,
      topChannels: [{ channelId: 'ch1', name: 'general', count: 10, uniqueUsers: 8 }],
      peakHourUtc: 3,
      hourlyCounts: stored,
    };
    setSystemTime(new Date('2026-10-05T12:00:00Z'));
    activityTracker.recordMessage(guildId, 'ch1', 'general', 'user1');
    activityTracker.recordMessage(guildId, 'ch1', 'general', 'user2');
    for (let i = 0; i < 3; i++) activityTracker.recordMessage(guildId, 'ch2', 'help', 'user1');

    await activityTracker.flushSnapshot(guildId, 100);

    const row = repoState.saved[0];
    expect(row.messageCount).toBe(15);
    expect(row.memberCount).toBe(100);
    expect(row.activeMembers).toBe(8); // larger window wins, not the post-restart 2
    expect(row.topChannels).toEqual([
      { channelId: 'ch1', name: 'general', count: 12, uniqueUsers: 8 },
      { channelId: 'ch2', name: 'help', count: 3, uniqueUsers: 1 },
    ]);
    expect(row.hourlyCounts[12]).toBe(5);
    expect(row.peakHourUtc).toBe(3); // recomputed from the merged histogram
  });
});

describe('activityTracker snapshot date — process time zone (v3.16.7)', () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    setSystemTime();
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  // The DATE column has no `utc: true`: TypeORM writes a Date as its local
  // calendar day and mysql2 sends a Date in a WHERE as a local DATETIME, so a
  // Date for 2026-10-06 meant 2026-10-05 on a CDT host. Run the real
  // conversions on what the tracker hands the repository.
  for (const tz of ['America/Chicago', 'Asia/Tokyo']) {
    test(`writes and looks up the UTC day under TZ=${tz}`, async () => {
      process.env.TZ = tz;
      const guildId = gid();
      setSystemTime(new Date('2026-10-06T02:00:00Z')); // still Oct 5 in Chicago
      activityTracker.recordMessage(guildId, 'ch1', 'general', 'user1');

      await activityTracker.flushSnapshot(guildId, 10);

      const where = analyticsRepo.findOneBy.mock.calls[0][0];
      expect(format('date = ?', [where.date])).toBe("date = '2026-10-06'");
      expect(DateUtils.mixedDateToDateString(repoState.saved[0].date)).toBe('2026-10-06');
    });
  }
});

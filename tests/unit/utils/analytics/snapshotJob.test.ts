/**
 * Snapshot job (v3.16.7): stale in-memory counters are cleaned on every
 * midnight run, including when no guild has analytics enabled. Before, that
 * case returned early, so counters (with a Set of every author ID per guild
 * per day) piled up until the next restart. Guilds with no activity get a
 * row for the day that just ended (not an empty one for the new day), and
 * the digest covers the full days that just ended.
 *
 * The job only exposes start/stop, so it runs here on fake timers with the
 * repositories patched through AppDataSource.getRepository.
 */

import { afterAll, afterEach, beforeAll, describe, expect, jest, setSystemTime, test } from 'bun:test';
import type { Client } from 'discord.js';
import { AnalyticsConfig } from '../../../../src/typeorm/entities/analytics/AnalyticsConfig';

const saved: { guildId: string; date: Date }[] = [];
let enabledConfigs: Partial<AnalyticsConfig>[] = [];
const snapshotFinds: any[] = [];

let activityTracker: typeof import('../../../../src/utils/analytics/activityTracker').activityTracker;
let startSnapshotJob: typeof import('../../../../src/utils/analytics/snapshotJob').startSnapshotJob;
let stopSnapshotJob: typeof import('../../../../src/utils/analytics/snapshotJob').stopSnapshotJob;
let originalGetRepository: unknown;
let AppDataSource: { getRepository: unknown };

beforeAll(async () => {
  AppDataSource = (await import('../../../../src/typeorm')).AppDataSource as unknown as typeof AppDataSource;
  originalGetRepository = AppDataSource.getRepository;
  AppDataSource.getRepository = (entity: unknown) =>
    entity === AnalyticsConfig
      ? { find: async () => enabledConfigs }
      : {
          find: async (opts: unknown) => {
            snapshotFinds.push(opts);
            return [];
          },
          findOneBy: async () => null,
          create: (row: { guildId: string; date: Date }) => row,
          save: async (row: { guildId: string; date: Date }) => saved.push(row),
          delete: async () => ({ affected: 0 }),
        };
  ({ activityTracker } = await import('../../../../src/utils/analytics/activityTracker'));
  ({ startSnapshotJob, stopSnapshotJob } = await import('../../../../src/utils/analytics/snapshotJob'));
});

afterAll(() => {
  AppDataSource.getRepository = originalGetRepository;
});

afterEach(() => {
  stopSnapshotJob();
  jest.useRealTimers();
  setSystemTime();
  enabledConfigs = [];
  saved.length = 0;
  snapshotFinds.length = 0;
});

/**
 * Start the job at 23:59 UTC Oct 4 and let its first run (60s later, at
 * midnight) finish. Fake timers move the clock as they advance, and stay on
 * until the run is done so it reads the midnight time throughout.
 */
async function runFirstMidnight(client: unknown): Promise<void> {
  jest.useFakeTimers();
  setSystemTime(new Date('2026-10-04T23:59:00Z'));
  startSnapshotJob(client as Client);
  jest.advanceTimersByTime(60_000 + 5);
  for (let i = 0; i < 200; i++) await Promise.resolve(); // the repos are in-memory fakes
  jest.useRealTimers();
}

describe('snapshot job — stale counter cleanup', () => {
  test('cleans the previous day even when no guild has analytics enabled', async () => {
    const guildId = `snapshot-noopt-${process.pid}`;
    setSystemTime(new Date('2026-10-04T23:59:00Z'));
    activityTracker.recordMessage(guildId, 'ch1', 'general', 'user1');

    await runFirstMidnight({ guilds: { cache: new Map() } }); // no guild has analytics enabled

    // If the Oct 4 counters had survived, an allow-listed flush would write them.
    await activityTracker.flushAll(new Map([[guildId, 1]]));
    expect(saved.filter(r => r.guildId === guildId)).toHaveLength(0);
  });
});

describe('snapshot job — the day that just ended', () => {
  test('an idle guild gets a row for the ended day; an active guild is written once', async () => {
    const idle = `snapshot-idle-${process.pid}`;
    const active = `snapshot-active-${process.pid}`;
    enabledConfigs = [
      { guildId: idle, enabled: true },
      { guildId: active, enabled: true },
    ];
    setSystemTime(new Date('2026-10-04T23:59:00Z'));
    activityTracker.recordMessage(active, 'ch1', 'general', 'user1');

    await runFirstMidnight({
      guilds: {
        cache: new Map([
          [idle, { memberCount: 42 }],
          [active, { memberCount: 7 }],
        ]),
      },
    });

    expect(saved.map(r => [r.guildId, r.date])).toEqual([
      [active, '2026-10-04'],
      [idle, '2026-10-04'],
    ]);
  });

  test('a weekly digest covers the 7 full UTC days that just ended', async () => {
    const guildId = `snapshot-digest-${process.pid}`;
    // Oct 5 2026 is a Monday (getUTCDay 1)
    enabledConfigs = [
      { guildId, enabled: true, digestChannelId: 'digest-ch', digestFrequency: 'weekly', digestDay: 1 },
    ];
    setSystemTime(new Date('2026-10-04T23:59:00Z'));
    const channel = { isTextBased: () => true, send: async () => undefined };

    await runFirstMidnight({
      guilds: { cache: new Map([[guildId, { memberCount: 1 }]]) },
      channels: { cache: new Map([['digest-ch', channel]]) },
    });

    expect(snapshotFinds).toHaveLength(1);
    expect(snapshotFinds[0].where.date.value).toEqual(['2026-09-28', '2026-10-04']);
  });
});

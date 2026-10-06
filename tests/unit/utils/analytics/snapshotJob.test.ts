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
let runMidnight: typeof import('../../../../src/utils/analytics/snapshotJob').runMidnight;
let runDailySnapshot: typeof import('../../../../src/utils/analytics/snapshotJob').runDailySnapshot;
let configFinds = 0;
let originalGetRepository: unknown;
let AppDataSource: { getRepository: unknown };

beforeAll(async () => {
  AppDataSource = (await import('../../../../src/typeorm')).AppDataSource as unknown as typeof AppDataSource;
  originalGetRepository = AppDataSource.getRepository;
  AppDataSource.getRepository = (entity: unknown) =>
    entity === AnalyticsConfig
      ? {
          find: async () => {
            configFinds++;
            return enabledConfigs;
          },
        }
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
  ({ startSnapshotJob, stopSnapshotJob, runMidnight, runDailySnapshot } = await import(
    '../../../../src/utils/analytics/snapshotJob'
  ));
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
  configFinds = 0;
});

/**
 * The midnight run for Oct 4 -> Oct 5, a few seconds after 00:00 UTC. It is
 * called directly with an explicit `now`: on Bun 1.3.x (the CI version) a
 * fake-timer callback reads the real clock, so the date can't be driven
 * through the scheduler. Scheduling itself is covered separately below.
 */
async function runFirstMidnight(client: unknown): Promise<void> {
  const at = new Date('2026-10-05T00:00:05Z');
  setSystemTime(at);
  await runDailySnapshot(client as Client, at.getTime());
}

describe('snapshot job — scheduling', () => {
  test('the first run fires at the next UTC midnight', async () => {
    jest.useFakeTimers();
    setSystemTime(new Date('2026-10-04T23:59:00Z'));
    startSnapshotJob({ guilds: { cache: new Map() } } as unknown as Client);
    jest.advanceTimersByTime(59_000);
    expect(configFinds).toBe(0);
    jest.advanceTimersByTime(1_005);
    for (let i = 0; i < 50; i++) await Promise.resolve();
    expect(configFinds).toBe(1);
  });
});

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

describe('snapshot job — run midnight', () => {
  test('a run that fires late, on time or slightly early belongs to the nearest UTC midnight', () => {
    const midnight = Date.parse('2026-10-05T00:00:00Z');
    expect(runMidnight(midnight).toISOString()).toBe('2026-10-05T00:00:00.000Z');
    expect(runMidnight(Date.parse('2026-10-05T00:07:30Z')).getTime()).toBe(midnight); // late timer
    expect(runMidnight(Date.parse('2026-10-05T03:00:00Z')).getTime()).toBe(midnight); // very late
    expect(runMidnight(Date.parse('2026-10-04T23:59:59.900Z')).getTime()).toBe(midnight); // interval drift
  });
});

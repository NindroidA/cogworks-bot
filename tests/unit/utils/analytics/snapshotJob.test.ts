/**
 * Snapshot job (v3.16.7): stale in-memory counters are cleaned on every
 * midnight run, including when no guild has analytics enabled. Before, that
 * case returned early, so counters (with a Set of every author ID per guild
 * per day) piled up until the next restart.
 *
 * The job only exposes start/stop, so it runs here on fake timers with the
 * repositories patched through AppDataSource.getRepository.
 */

import { afterAll, afterEach, beforeAll, describe, expect, jest, setSystemTime, test } from 'bun:test';
import type { Client } from 'discord.js';
import { AnalyticsConfig } from '../../../../src/typeorm/entities/analytics/AnalyticsConfig';

const saved: { guildId: string; date: Date }[] = [];

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
      ? { find: async () => [] } // no guild has analytics enabled
      : {
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
});

describe('snapshot job — stale counter cleanup', () => {
  test('cleans the previous day even when no guild has analytics enabled', async () => {
    const guildId = `snapshot-noopt-${process.pid}`;
    setSystemTime(new Date('2026-10-04T23:59:00Z'));
    activityTracker.recordMessage(guildId, 'ch1', 'general', 'user1');

    jest.useFakeTimers();
    startSnapshotJob({ guilds: { cache: new Map() } } as unknown as Client);
    setSystemTime(new Date('2026-10-05T00:00:30Z'));
    jest.advanceTimersByTime(24 * 60 * 60 * 1000); // past the first midnight run, whatever its delay
    for (let i = 0; i < 20; i++) await Promise.resolve();
    jest.useRealTimers();

    // If the Oct 4 counters had survived, an allow-listed flush would write them.
    await activityTracker.flushAll(new Map([[guildId, 1]]));
    expect(saved.filter(r => r.guildId === guildId)).toHaveLength(0);
  });
});

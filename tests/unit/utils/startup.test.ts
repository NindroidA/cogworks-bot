/**
 * Boot helpers: periodic job wiring and isolated init steps (v3.16.6), and the
 * graceful-shutdown analytics flush (v3.16.7). index.ts runs the bot on import,
 * so the logic lives in src/utils/startup.ts and is exercised here.
 */

import { afterAll, afterEach, beforeAll, describe, expect, jest, test } from 'bun:test';
import type { Client } from 'discord.js';
import { AnalyticsConfig } from '../../../src/typeorm/entities/analytics/AnalyticsConfig';
import { activityTracker } from '../../../src/utils/analytics/activityTracker';
import { checkAndSendWeeklySummaries } from '../../../src/utils/baitChannel/weeklySummary';
import { INTERVALS } from '../../../src/utils/constants';
import { checkAndSendReminders } from '../../../src/utils/event/reminderChecker';
import {
  createJobTick,
  flushAnalyticsOnShutdown,
  PERIODIC_JOBS,
  runInitStep,
  startPeriodicJobs,
  stopPeriodicJobs,
} from '../../../src/utils/startup';
import { checkAndAutoCloseTickets } from '../../../src/utils/ticket/autoClose';
import { checkAndAlertSlaBreaches } from '../../../src/utils/ticket/slaChecker';

const client = {} as Client;

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('PERIODIC_JOBS', () => {
  test('schedules every periodic checker on its INTERVALS constant', () => {
    const intervalByRun = new Map(PERIODIC_JOBS.map(job => [job.run, job.intervalMs]));
    expect(intervalByRun.get(checkAndAlertSlaBreaches)).toBe(INTERVALS.SLA_CHECK);
    expect(intervalByRun.get(checkAndSendReminders)).toBe(INTERVALS.REMINDER_CHECK);
    expect(intervalByRun.get(checkAndAutoCloseTickets)).toBe(INTERVALS.AUTO_CLOSE_CHECK);
    expect(intervalByRun.get(checkAndSendWeeklySummaries)).toBe(INTERVALS.WEEKLY_SUMMARY);
  });

  test('reminders tick at least once a minute, so "N minutes before" lands before the event', () => {
    expect(INTERVALS.REMINDER_CHECK).toBeLessThanOrEqual(60_000);
  });
});

describe('startPeriodicJobs / stopPeriodicJobs', () => {
  afterEach(() => {
    stopPeriodicJobs();
    jest.useRealTimers();
  });

  test('runs each job on its interval with the client, and stops on shutdown', async () => {
    jest.useFakeTimers();
    const run = jest.fn(async (_client: Client) => {});
    startPeriodicJobs(client, [{ name: 'test job', intervalMs: 1000, run }]);

    for (let i = 0; i < 3; i++) {
      jest.advanceTimersByTime(1000);
      await flushMicrotasks();
    }
    expect(run).toHaveBeenCalledTimes(3);
    expect(run).toHaveBeenCalledWith(client);

    stopPeriodicJobs();
    jest.advanceTimersByTime(5000);
    expect(run).toHaveBeenCalledTimes(3);
  });
});

describe('createJobTick', () => {
  test('skips a tick while the previous run is still in flight', async () => {
    let finish: () => void = () => {};
    const run = jest.fn(() => new Promise<void>(resolve => (finish = resolve)));
    const tick = createJobTick({ name: 'slow', intervalMs: 1000, run }, client);

    const first = tick();
    await tick(); // overlapping tick: skipped
    expect(run).toHaveBeenCalledTimes(1);

    finish();
    await first;
    const third = tick();
    finish();
    await third;
    expect(run).toHaveBeenCalledTimes(2);
  });

  test('a failing run never rejects the tick', async () => {
    const tick = createJobTick(
      { name: 'broken', intervalMs: 1000, run: async () => Promise.reject(new Error('boom')) },
      client,
    );
    await expect(tick()).resolves.toBeUndefined();
  });
});

describe('runInitStep', () => {
  test('a throwing or rejecting step is contained and later steps still run', async () => {
    const ran: string[] = [];
    expect(
      await runInitStep('sync throw', () => {
        throw new Error('sync failure');
      }),
    ).toBe(false);
    expect(await runInitStep('async reject', async () => Promise.reject(new Error('db lock timeout')))).toBe(false);
    expect(await runInitStep('ok', () => ran.push('ok'))).toBe(true);
    expect(ran).toEqual(['ok']);
  });
});

describe('flushAnalyticsOnShutdown', () => {
  const saved: { guildId: string; memberCount: number }[] = [];
  let configFind: () => Promise<unknown> = async () => [];
  let originalGetRepository: unknown;
  let originalInitialized: boolean;
  let AppDataSource: { getRepository: unknown; isInitialized: boolean };

  beforeAll(async () => {
    AppDataSource = (await import('../../../src/typeorm')).AppDataSource as unknown as typeof AppDataSource;
    originalGetRepository = AppDataSource.getRepository;
    originalInitialized = AppDataSource.isInitialized;
    AppDataSource.isInitialized = true;
    AppDataSource.getRepository = (entity: unknown) =>
      entity === AnalyticsConfig
        ? { find: () => configFind() }
        : {
            findOneBy: async () => null,
            create: (row: { guildId: string; memberCount: number }) => row,
            save: async (row: { guildId: string; memberCount: number }) => saved.push(row),
          };
  });

  afterAll(() => {
    AppDataSource.getRepository = originalGetRepository;
    AppDataSource.isInitialized = originalInitialized;
  });

  test('writes the day so far for enabled guilds still in the cache; drops everyone else', async () => {
    const enabled = `shutdown-enabled-${process.pid}`;
    const optedOut = `shutdown-optout-${process.pid}`;
    configFind = async () => [{ guildId: enabled }, { guildId: `shutdown-left-${process.pid}` }];
    activityTracker.recordMessage(enabled, 'ch1', 'general', 'user1');
    activityTracker.recordMessage(optedOut, 'ch1', 'general', 'user1');
    const shuttingDown = { guilds: { cache: new Map([[enabled, { memberCount: 42 }]]) } } as unknown as Client;

    await flushAnalyticsOnShutdown(shuttingDown);

    expect(saved.map(r => [r.guildId, r.memberCount])).toEqual([[enabled, 42]]);
    expect(activityTracker.hasCounters(optedOut)).toBe(false);
  });

  test('gives up after the timeout instead of blocking exit', async () => {
    configFind = () => new Promise(() => {}); // DB never answers
    const started = Date.now();
    await flushAnalyticsOnShutdown({ guilds: { cache: new Map() } } as unknown as Client, 20);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

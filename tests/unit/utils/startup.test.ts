/**
 * Boot helpers (v3.16.6): periodic job wiring and isolated init steps.
 * index.ts runs the bot on import, so the logic lives in src/utils/startup.ts
 * and is exercised here.
 */

import { afterEach, describe, expect, jest, test } from 'bun:test';
import type { Client } from 'discord.js';
import { checkAndSendWeeklySummaries } from '../../../src/utils/baitChannel/weeklySummary';
import { INTERVALS } from '../../../src/utils/constants';
import { checkAndSendReminders } from '../../../src/utils/event/reminderChecker';
import {
  createJobTick,
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

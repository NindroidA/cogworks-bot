/**
 * isStaleReminder (v3.16.6): the reminder checker now runs every minute in
 * production, so backlog rows (bot offline at reminderAt, event already
 * started/ended/cancelled) are marked sent without posting.
 */

import { describe, expect, test } from 'bun:test';
import { GuildScheduledEventStatus } from 'discord.js';
import { SCHEDULER_GUARDS } from '../../../../src/utils/constants';
import { isStaleReminder } from '../../../../src/utils/event/reminderChecker';

const now = Date.UTC(2026, 9, 6, 12);
const MIN = 60_000;
const dueMsAgo = (ms: number) => ({ reminderAt: new Date(now - ms) });
const event = (status: GuildScheduledEventStatus, startsInMs: number) => ({
  status,
  scheduledStartTimestamp: now + startsInMs,
});

describe('isStaleReminder', () => {
  test('a just-due reminder for an upcoming event is sent', () => {
    expect(isStaleReminder(dueMsAgo(30_000), event(GuildScheduledEventStatus.Scheduled, 15 * MIN), now)).toBe(false);
  });

  test('a long-overdue reminder is still sent while its event has not started (7-day lead time)', () => {
    expect(
      isStaleReminder(dueMsAgo(3 * 60 * MIN), event(GuildScheduledEventStatus.Scheduled, 2 * 24 * 60 * MIN), now),
    ).toBe(false);
  });

  test('stale once the event has started, ended or been cancelled', () => {
    expect(isStaleReminder(dueMsAgo(MIN), event(GuildScheduledEventStatus.Scheduled, -MIN), now)).toBe(true);
    expect(isStaleReminder(dueMsAgo(MIN), event(GuildScheduledEventStatus.Active, -MIN), now)).toBe(true);
    expect(isStaleReminder(dueMsAgo(MIN), event(GuildScheduledEventStatus.Completed, -60 * MIN), now)).toBe(true);
    expect(isStaleReminder(dueMsAgo(MIN), event(GuildScheduledEventStatus.Canceled, 60 * MIN), now)).toBe(true);
  });

  test('event not fetchable: send with the fallback title unless the reminder is past the stale window', () => {
    expect(isStaleReminder(dueMsAgo(5 * MIN), null, now)).toBe(false);
    expect(isStaleReminder(dueMsAgo(SCHEDULER_GUARDS.REMINDER_STALE_AFTER_MS + MIN), null, now)).toBe(true);
  });
});

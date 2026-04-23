import { describe, expect, test } from 'bun:test';
import { __testing } from '../../../../src/utils/api/handlers/analyticsHandlers';

const { parseDaysWindow, parseFromToWindow, pctChange, formatIsoDate, MAX_RANGE_DAYS } = __testing;

describe('pctChange', () => {
  test('formats increases with a leading +', () => {
    expect(pctChange(110, 100)).toBe('+10%');
  });

  test('formats decreases with a leading -', () => {
    expect(pctChange(80, 100)).toBe('-20%');
  });

  test('renders an em-dash when previous is zero and current is positive', () => {
    expect(pctChange(12, 0)).toBe('—');
  });

  test('renders 0% when both current and previous are zero', () => {
    expect(pctChange(0, 0)).toBe('0%');
  });

  test('rounds to nearest whole percent', () => {
    expect(pctChange(101, 100)).toBe('+1%');
    expect(pctChange(99, 100)).toBe('-1%');
  });
});

describe('formatIsoDate', () => {
  test('returns YYYY-MM-DD in UTC', () => {
    const d = new Date('2026-04-20T15:34:00Z');
    expect(formatIsoDate(d)).toBe('2026-04-20');
  });
});

describe('parseDaysWindow', () => {
  test('uses fallbackDays when `days` is absent', () => {
    const { days } = parseDaysWindow('/analytics/growth', 30);
    expect(days).toBe(30);
  });

  test('respects an explicit `days` query param', () => {
    const { days } = parseDaysWindow('/analytics/growth?days=14', 30);
    expect(days).toBe(14);
  });

  test('clamps `days` to MAX_RANGE_DAYS', () => {
    const { days } = parseDaysWindow(`/analytics/growth?days=${MAX_RANGE_DAYS + 500}`, 30);
    expect(days).toBe(MAX_RANGE_DAYS);
  });

  test('rejects zero or negative values', () => {
    expect(() => parseDaysWindow('/analytics/growth?days=0', 30)).toThrow();
    expect(() => parseDaysWindow('/analytics/growth?days=-5', 30)).toThrow();
  });

  test('rejects non-numeric values', () => {
    expect(() => parseDaysWindow('/analytics/growth?days=abc', 30)).toThrow();
  });

  test('`to` is today at UTC midnight, `from` is N-1 days earlier', () => {
    const { from, to } = parseDaysWindow('/analytics/growth?days=7', 7);
    expect(to.getUTCHours()).toBe(0);
    expect(to.getUTCMinutes()).toBe(0);
    // from should be 6 days before to for a 7-day inclusive window.
    const span = Math.round((to.getTime() - from.getTime()) / 86_400_000);
    expect(span).toBe(6);
  });
});

describe('parseFromToWindow', () => {
  test('parses a valid YYYY-MM-DD range', () => {
    const { from, to } = parseFromToWindow('/analytics/snapshots?from=2026-03-01&to=2026-03-31');
    expect(formatIsoDate(from)).toBe('2026-03-01');
    expect(formatIsoDate(to)).toBe('2026-03-31');
  });

  test('rejects missing from/to', () => {
    expect(() => parseFromToWindow('/analytics/snapshots')).toThrow();
    expect(() => parseFromToWindow('/analytics/snapshots?from=2026-03-01')).toThrow();
  });

  test('rejects malformed dates', () => {
    expect(() => parseFromToWindow('/analytics/snapshots?from=2026/03/01&to=2026-03-31')).toThrow();
    expect(() => parseFromToWindow('/analytics/snapshots?from=03-01-2026&to=2026-03-31')).toThrow();
  });

  test('rejects `from` after `to`', () => {
    expect(() => parseFromToWindow('/analytics/snapshots?from=2026-03-31&to=2026-03-01')).toThrow();
  });

  test('rejects ranges exceeding MAX_RANGE_DAYS', () => {
    // 2025-01-01 → 2026-12-31 is ~730 days — well over the 365 cap.
    expect(() =>
      parseFromToWindow('/analytics/snapshots?from=2025-01-01&to=2026-12-31'),
    ).toThrow();
  });

  test('accepts exactly MAX_RANGE_DAYS', () => {
    // 2026-01-01 + 364 days = 2026-12-31 (365 days inclusive).
    const { from, to } = parseFromToWindow('/analytics/snapshots?from=2026-01-01&to=2026-12-31');
    const span = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
    expect(span).toBe(MAX_RANGE_DAYS);
  });
});

/**
 * time primitive unit tests.
 *
 * toUnixSeconds / nowUnixSeconds are pure and exact; sleep is verified to
 * actually delay (loose lower bound to avoid timer flake).
 */

import { describe, expect, test } from 'bun:test';
import { nowUnixSeconds, sleep, toUnixSeconds } from '../../../src/utils/time';

describe('toUnixSeconds', () => {
  test('converts epoch to 0', () => {
    expect(toUnixSeconds(new Date(0))).toBe(0);
  });

  test('converts a known millisecond timestamp to whole seconds', () => {
    expect(toUnixSeconds(new Date(1_700_000_000_000))).toBe(1_700_000_000);
  });

  test('floors sub-second milliseconds (does not round up)', () => {
    expect(toUnixSeconds(new Date(1_999))).toBe(1);
  });
});

describe('nowUnixSeconds', () => {
  test('matches Math.floor(Date.now() / 1000) within a second', () => {
    const expected = Math.floor(Date.now() / 1000);
    const actual = nowUnixSeconds();
    expect(actual).toBeGreaterThanOrEqual(expected - 1);
    expect(actual).toBeLessThanOrEqual(expected + 1);
  });
});

describe('sleep', () => {
  test('resolves after roughly the requested delay', async () => {
    const start = Date.now();
    await sleep(30);
    expect(Date.now() - start).toBeGreaterThanOrEqual(10);
  });

  test('resolves to undefined', async () => {
    expect(await sleep(1)).toBeUndefined();
  });
});

/**
 * createTtlCache unit tests — get/set/getOrLoad/invalidate/invalidateWhere/clear
 * + TTL expiry, exercised deterministically via the injectable clock.
 */

import { describe, expect, jest, test } from 'bun:test';
import { createTtlCache } from '../../../../src/utils/database/configCache';

function clock(start = 1000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('createTtlCache', () => {
  test('get returns set value before TTL, undefined after', () => {
    const c = clock();
    const cache = createTtlCache<string, number>(1000, c.now);
    cache.set('a', 42);
    expect(cache.get('a')).toBe(42);
    c.advance(999);
    expect(cache.get('a')).toBe(42);
    c.advance(1); // now exactly at TTL → expired (>= ttl)
    expect(cache.get('a')).toBeUndefined();
  });

  test('expired entry is evicted on read (size shrinks)', () => {
    const c = clock();
    const cache = createTtlCache<string, number>(100, c.now);
    cache.set('a', 1);
    expect(cache.size).toBe(1);
    c.advance(200);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  test('get returns undefined for absent key', () => {
    const cache = createTtlCache<string, number>(1000);
    expect(cache.get('missing')).toBeUndefined();
  });

  test('cached empty array round-trips (distinct from miss)', () => {
    const cache = createTtlCache<string, number[]>(1000);
    cache.set('g', []);
    expect(cache.get('g')).toEqual([]);
  });

  test('getOrLoad caches a non-null load and does not re-run loader', async () => {
    const cache = createTtlCache<string, string>(1000);
    const loader = jest.fn(async () => 'val');
    expect(await cache.getOrLoad('k', loader)).toBe('val');
    expect(await cache.getOrLoad('k', loader)).toBe('val');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test('getOrLoad does NOT cache null/undefined results', async () => {
    const cache = createTtlCache<string, unknown>(1000);
    const loader = jest.fn(async () => null);
    await cache.getOrLoad('k', loader);
    await cache.getOrLoad('k', loader);
    expect(loader).toHaveBeenCalledTimes(2); // not cached → loader runs again
  });

  test('getOrLoad propagates loader errors uncached', async () => {
    const cache = createTtlCache<string, string>(1000);
    const loader = jest.fn(async () => {
      throw new Error('db down');
    });
    await expect(cache.getOrLoad('k', loader)).rejects.toThrow('db down');
    expect(cache.size).toBe(0);
  });

  test('invalidate drops one key; clear drops all', () => {
    const cache = createTtlCache<string, number>(1000);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.invalidate('a');
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    cache.clear();
    expect(cache.get('b')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  test('invalidateWhere drops entries matching a value predicate (guild-scoped use case)', () => {
    const cache = createTtlCache<string, { guildId: string }>(1000);
    cache.set('msg1', { guildId: 'g1' });
    cache.set('msg2', { guildId: 'g2' });
    cache.set('msg3', { guildId: 'g1' });
    cache.invalidateWhere(v => v.guildId === 'g1');
    expect(cache.get('msg1')).toBeUndefined();
    expect(cache.get('msg3')).toBeUndefined();
    expect(cache.get('msg2')).toEqual({ guildId: 'g2' });
  });

  test('methods are destructure-safe (no this binding)', () => {
    const { set, get } = createTtlCache<string, number>(1000);
    set('x', 7);
    expect(get('x')).toBe(7);
  });
});

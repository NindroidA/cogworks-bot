/**
 * Health engine context: row loading (once per entity, guild-scoped, failures
 * kept distinct from "no rows") and the budgeted REST fetcher.
 */
import { describe, expect, test } from 'bun:test';
import { DiscordAPIError } from 'discord.js';
import {
  createRestFetcher,
  HealthDataUnavailableError,
  type HealthEntityName,
  loadRows,
  repoRowLoader,
  rowsOf,
} from '../../../../src/utils/health/context';
import { makeFakeRepo, writeCallCount } from '../../../helpers/fakeRepo';
import { makeCheckContext } from '../../../helpers/healthContext';

const G = '100000000000000001';

describe('loadRows', () => {
  test('loads each entity once, with the guild id, in parallel', async () => {
    const calls: [HealthEntityName, string][] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const loader = async (entity: HealthEntityName, guildId: string) => {
      calls.push([entity, guildId]);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(resolve => setTimeout(resolve, 5));
      inFlight--;
      return [{ entity }];
    };
    const rows = await loadRows(G, ['BotConfig', 'StaffRole', 'BotConfig', 'SetupState'], loader);
    expect(calls).toEqual([
      ['BotConfig', G],
      ['StaffRole', G],
      ['SetupState', G],
    ]);
    expect(maxInFlight).toBe(3);
    expect(rows.BotConfig).toEqual([{ entity: 'BotConfig' }]);
  });

  test('a failed entity becomes null; the others still load', async () => {
    const rows = await loadRows(G, ['BotConfig', 'StaffRole'], async entity => {
      if (entity === 'StaffRole') throw new Error('ER_LOCK_WAIT_TIMEOUT');
      return [];
    });
    expect(rows).toEqual({ BotConfig: [], StaffRole: null });
  });

  test('a loader that throws synchronously only fails its own entity', async () => {
    const rows = await loadRows(G, ['BotConfig', 'StaffRole'], entity => {
      if (entity === 'BotConfig') throw new Error('No metadata for "BotConfig" was found');
      return Promise.resolve([]);
    });
    expect(rows).toEqual({ BotConfig: null, StaffRole: [] });
  });

  test('repoRowLoader issues one guild-scoped find and never writes', async () => {
    const repo = makeFakeRepo([
      { id: 1, guildId: G, role: 'a' },
      { id: 2, guildId: 'other-guild', role: 'b' },
    ]);
    const loader = repoRowLoader(() => repo);
    expect(await loader('StaffRole', G)).toEqual([{ id: 1, guildId: G, role: 'a' }]);
    expect(repo.findCalls).toEqual([{ where: { guildId: G } }]);
    expect(writeCallCount(repo)).toBe(0);
  });
});

describe('rowsOf', () => {
  test('returns the declared rows', () => {
    const ctx = makeCheckContext({ rows: { StaffRole: [{ id: 1 }] } });
    expect(rowsOf(ctx, 'StaffRole')).toEqual([{ id: 1 }] as never);
  });

  test('throws HealthDataUnavailableError when the load failed (never "no rows")', () => {
    const ctx = makeCheckContext({ rows: { StaffRole: null } });
    expect(() => rowsOf(ctx, 'StaffRole')).toThrow(HealthDataUnavailableError);
  });

  test('throws when the check did not declare the entity', () => {
    const ctx = makeCheckContext({ rows: {} });
    expect(() => rowsOf(ctx, 'BotConfig')).toThrow(/without declaring/);
  });
});

describe('createRestFetcher', () => {
  const budget = { concurrency: 4, timeoutMs: 50, maxCalls: 60 };

  test('ok value, and null/undefined count as missing', async () => {
    const rest = createRestFetcher(budget);
    expect(await rest.fetch('msg', async () => ({ id: 'm' }))).toEqual({ status: 'ok', value: { id: 'm' } });
    expect(await rest.fetch('role', async () => null)).toEqual({ status: 'missing' });
    expect(await rest.fetch('emoji', async () => undefined)).toEqual({ status: 'missing' });
  });

  test('classifies thrown errors', async () => {
    const rest = createRestFetcher(budget);
    const unknownMessage = new DiscordAPIError({ code: 10008, message: 'Unknown Message' }, 10008, 404, 'GET', '/', {});
    const missingAccess = new DiscordAPIError({ code: 50001, message: 'Missing Access' }, 50001, 403, 'GET', '/', {});
    expect(await rest.fetch('a', () => Promise.reject(unknownMessage))).toEqual({ status: 'missing' });
    expect(await rest.fetch('b', () => Promise.reject(missingAccess))).toEqual({ status: 'inaccessible' });
    expect(await rest.fetch('c', () => Promise.reject({ status: 503 }))).toEqual({ status: 'unknown' });
  });

  test('a call slower than the timeout is unknown, not missing', async () => {
    const rest = createRestFetcher({ ...budget, timeoutMs: 10 });
    const outcome = await rest.fetch('slow', () => new Promise(resolve => setTimeout(() => resolve('late'), 200)));
    expect(outcome).toEqual({ status: 'unknown' });
  });

  test('calls over the budget are skipped and recorded', async () => {
    const rest = createRestFetcher({ ...budget, maxCalls: 2 });
    let ran = 0;
    const call = async () => ++ran;
    const outcomes = await Promise.all([rest.fetch('a', call), rest.fetch('b', call), rest.fetch('c', call)]);
    expect(outcomes.map(o => o.status)).toEqual(['ok', 'ok', 'skipped']);
    expect(ran).toBe(2);
    expect(rest.skipped).toEqual(['c']);
  });

  test('never runs more than `concurrency` calls at once', async () => {
    const rest = createRestFetcher({ ...budget, concurrency: 2 });
    let active = 0;
    let peak = 0;
    const call = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      return true;
    };
    const outcomes = await Promise.all(Array.from({ length: 6 }, (_, i) => rest.fetch(`c${i}`, call)));
    expect(outcomes.every(o => o.status === 'ok')).toBe(true);
    expect(peak).toBe(2);
  });

  test('a failing call releases its slot', async () => {
    const rest = createRestFetcher({ ...budget, concurrency: 1 });
    await rest.fetch('boom', () => Promise.reject(new Error('x')));
    expect(await rest.fetch('next', async () => 1)).toEqual({ status: 'ok', value: 1 });
  });
});

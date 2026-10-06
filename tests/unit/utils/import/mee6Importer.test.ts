/**
 * Mee6Importer page errors (NindroidA/cogworks-bot#41, finding #108 review).
 *
 * A network or JSON error on any page used to stop paging but still report
 * success with the pages fetched so far, so a partial leaderboard was written.
 * Now it fails the whole import, like a 403/429/5xx response. `fetch` is
 * swapped per test and restored; the page delay is injected as 0.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { Mee6Importer } from '../../../../src/utils/import/mee6Importer';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const players = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: (100000000000000000n + BigInt(i)).toString(),
    username: `u${i}`,
    discriminator: '0',
    xp: i * 10,
    level: 0,
    message_count: i,
  }));

/** Serve the given page bodies in order; a thrown Error or a string body simulates a failure. */
function serve(pages: Array<unknown>) {
  let calls = 0;
  globalThis.fetch = (async () => {
    const page = pages[calls++];
    if (page instanceof Error) throw page;
    return new Response(typeof page === 'string' ? page : JSON.stringify(page), { status: 200 });
  }) as unknown as typeof fetch;
  return () => calls;
}

describe('Mee6Importer', () => {
  test('a short leaderboard returns its records', async () => {
    serve([{ players: players(3), page: 0 }]);
    const result = await new Mee6Importer(0).import('guild', 'xp');
    expect(result).toMatchObject({ success: true, imported: 3 });
    expect(result.records).toHaveLength(3);
  });

  test('a network error on a later page fails the whole import', async () => {
    serve([{ players: players(1000), page: 0 }, new Error('ECONNRESET')]);
    const result = await new Mee6Importer(0).import('guild', 'xp');
    expect(result).toMatchObject({ success: false, imported: 0 });
    expect(result.records).toBeUndefined();
    expect(result.errors[0]).toBe('Error fetching page 1: ECONNRESET');
  });

  test('invalid JSON on a page fails the whole import', async () => {
    serve([{ players: players(1000), page: 0 }, '<html>gateway error</html>']);
    const result = await new Mee6Importer(0).import('guild', 'xp');
    expect(result.success).toBe(false);
    expect(result.records).toBeUndefined();
  });

  test('stops fetching pages once the import is cancelled', async () => {
    const calls = serve([{ players: players(1000), page: 0 }, { players: players(1000), page: 1 }]);
    let cancelled = false;
    await new Mee6Importer(0).import('guild', 'xp', {
      onProgress: () => {
        cancelled = true;
      },
      isCancelled: () => cancelled,
    });
    expect(calls()).toBe(1);
  });
});

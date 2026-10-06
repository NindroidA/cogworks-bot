/**
 * Imported XP writer (NindroidA/cogworks-bot#41, finding #108).
 *
 * Before: /import mee6 and /import csv parsed the records and reported them as
 * imported, but nothing ever wrote an XPUser row. The writer upserts them
 * guild-scoped, in chunks, inside one transaction, recomputes the level with
 * the bot's own curve and honors overwrite / dry-run.
 */

import { describe, expect, test } from 'bun:test';
import type { RawXpRecord } from '../../../../src/utils/import/types';
import {
  ImportCancelledError,
  writeImportedXp,
  XP_WRITE_CHUNK_SIZE,
  type XpImportRow,
  type XpImportStore,
  type XpImportTransaction,
} from '../../../../src/utils/import/xpWriter';
import { calculateLevel } from '../../../../src/utils/xp/xpCalculator';

const GUILD = '100000000000000001';
const OTHER_GUILD = '100000000000000002';

/** In-memory XPUser table keyed like the unique (guildId, userId) index. */
function makeStore(existing: XpImportRow[] = []) {
  const rows = new Map(existing.map(r => [`${r.guildId}:${r.userId}`, { ...r }]));
  const calls = { existing: [] as Array<{ guildId: string; userIds: string[] }>, insert: [] as number[], upsert: [] as number[] };
  let transactions = 0;
  const store: XpImportStore = {
    async existingUserIds(guildId, userIds) {
      calls.existing.push({ guildId, userIds });
      return new Set(userIds.filter(id => rows.has(`${guildId}:${id}`)));
    },
    async insertNew(batch) {
      calls.insert.push(batch.length);
      for (const r of batch) if (!rows.has(`${r.guildId}:${r.userId}`)) rows.set(`${r.guildId}:${r.userId}`, { ...r });
    },
    async upsert(batch) {
      calls.upsert.push(batch.length);
      for (const r of batch) rows.set(`${r.guildId}:${r.userId}`, { ...rows.get(`${r.guildId}:${r.userId}`), ...r });
    },
  };
  const transaction: XpImportTransaction = async work => {
    transactions++;
    return work(store);
  };
  return { rows, calls, transaction, transactionCount: () => transactions };
}

function record(userId: string, xp: number, level = 99, messageCount = 7): RawXpRecord {
  return { userId, xp, level, messageCount };
}

describe('writeImportedXp', () => {
  test('writes guild-scoped rows with the level recomputed from XP', async () => {
    const store = makeStore();
    const result = await writeImportedXp(
      GUILD,
      [record('1', 2500, 42, 30), record('2', 99.9, 0, 4.5)],
      { overwrite: false, dryRun: false },
      store.transaction,
    );

    expect(result).toEqual({ written: 2, skippedExisting: 0 });
    expect(store.rows.get(`${GUILD}:1`)).toEqual({
      guildId: GUILD,
      userId: '1',
      xp: 2500,
      level: calculateLevel(2500),
      messages: 30,
    });
    // Fractions are floored to fit the INT columns
    expect(store.rows.get(`${GUILD}:2`)).toMatchObject({ xp: 99, level: 0, messages: 4 });
    expect([...store.rows.keys()].every(k => k.startsWith(`${GUILD}:`))).toBe(true);
    expect(store.calls.existing.every(c => c.guildId === GUILD)).toBe(true);
  });

  test('without overwrite, users who already have XP keep it and count as skipped', async () => {
    const store = makeStore([
      { guildId: GUILD, userId: '1', xp: 5, level: 0, messages: 1 },
      // Same user in another guild must not block the import here
      { guildId: OTHER_GUILD, userId: '2', xp: 9, level: 0, messages: 1 },
    ]);
    const result = await writeImportedXp(
      GUILD,
      [record('1', 1000), record('2', 2000)],
      { overwrite: false, dryRun: false },
      store.transaction,
    );

    expect(result).toEqual({ written: 1, skippedExisting: 1 });
    expect(store.rows.get(`${GUILD}:1`)?.xp).toBe(5);
    expect(store.rows.get(`${GUILD}:2`)?.xp).toBe(2000);
    expect(store.rows.get(`${OTHER_GUILD}:2`)?.xp).toBe(9);
    expect(store.calls.upsert).toHaveLength(0);
  });

  test('with overwrite, existing users are replaced through an upsert', async () => {
    const store = makeStore([{ guildId: GUILD, userId: '1', xp: 5, level: 0, messages: 1 }]);
    const result = await writeImportedXp(
      GUILD,
      [record('1', 1000), record('2', 2000)],
      { overwrite: true, dryRun: false },
      store.transaction,
    );

    expect(result).toEqual({ written: 2, skippedExisting: 0 });
    expect(store.rows.get(`${GUILD}:1`)?.xp).toBe(1000);
    expect(store.calls.existing).toHaveLength(0);
    expect(store.calls.insert).toHaveLength(0);
  });

  test('a dry run counts what would be written and skipped but writes nothing', async () => {
    const store = makeStore([{ guildId: GUILD, userId: '1', xp: 5, level: 0, messages: 1 }]);
    const result = await writeImportedXp(
      GUILD,
      [record('1', 1000), record('2', 2000)],
      { overwrite: false, dryRun: true },
      store.transaction,
    );

    expect(result).toEqual({ written: 1, skippedExisting: 1 });
    expect(store.calls.insert).toHaveLength(0);
    expect(store.calls.upsert).toHaveLength(0);
    expect(store.rows.size).toBe(1);
  });

  test('writes in chunks inside a single transaction', async () => {
    const store = makeStore();
    const records = Array.from({ length: XP_WRITE_CHUNK_SIZE * 2 + 3 }, (_, i) => record(String(i), i));
    const result = await writeImportedXp(GUILD, records, { overwrite: false, dryRun: false }, store.transaction);

    expect(result.written).toBe(records.length);
    expect(store.calls.insert).toEqual([XP_WRITE_CHUNK_SIZE, XP_WRITE_CHUNK_SIZE, 3]);
    expect(store.transactionCount()).toBe(1);
  });

  test('a database error propagates so the caller can fail the import', async () => {
    const failing: XpImportTransaction = async work =>
      work({
        existingUserIds: async () => new Set(),
        insertNew: async () => {
          throw new Error('ER_LOCK_WAIT_TIMEOUT');
        },
        upsert: async () => undefined,
      });

    await expect(
      writeImportedXp(GUILD, [record('1', 10)], { overwrite: false, dryRun: false }, failing),
    ).rejects.toThrow('ER_LOCK_WAIT_TIMEOUT');
  });

  test('a cancel stops before the next chunk and before the commit', async () => {
    const store = makeStore();
    const records = Array.from({ length: XP_WRITE_CHUNK_SIZE + 1 }, (_, i) => record(String(i), i));
    let cancelled = false;
    const cancelAfterFirstChunk: XpImportTransaction = work =>
      store.transaction(s =>
        work({
          ...s,
          insertNew: async rows => {
            await s.insertNew(rows);
            cancelled = true;
          },
        }),
      );

    await expect(
      writeImportedXp(GUILD, records, { overwrite: false, dryRun: false, isCancelled: () => cancelled }, cancelAfterFirstChunk),
    ).rejects.toBeInstanceOf(ImportCancelledError);
    expect(store.calls.insert).toEqual([XP_WRITE_CHUNK_SIZE]);

    // Cancelled during the last chunk: still thrown inside the transaction, so it rolls back
    const single = makeStore();
    let late = false;
    const lateCancel: XpImportTransaction = work =>
      single.transaction(s => work({ ...s, insertNew: async rows => { await s.insertNew(rows); late = true; } }));
    await expect(
      writeImportedXp(GUILD, [record('1', 5)], { overwrite: false, dryRun: false, isCancelled: () => late }, lateCancel),
    ).rejects.toBeInstanceOf(ImportCancelledError);
  });

  test('no records opens no transaction', async () => {
    const store = makeStore();
    expect(await writeImportedXp(GUILD, [], { overwrite: false, dryRun: false }, store.transaction)).toEqual({
      written: 0,
      skippedExisting: 0,
    });
    expect(store.transactionCount()).toBe(0);
  });
});

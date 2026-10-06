/**
 * Imported XP Writer
 *
 * Writes parsed MEE6 / CSV records into XPUser for one guild, in one
 * transaction, in chunks keyed on the unique (guildId, userId) index. Level is
 * recomputed from XP with the bot's own curve, since the source's level may use
 * a different one. With overwrite off, users who already have a row keep it and
 * are counted as skipped.
 */

import { type EntityManager, In } from 'typeorm';
import { AppDataSource } from '../../typeorm';
import { XPUser } from '../../typeorm/entities/xp/XPUser';
import { calculateLevel } from '../xp/xpCalculator';
import type { RawXpRecord } from './types';

export const XP_WRITE_CHUNK_SIZE = 500;

/** XPUser.xp and XPUser.messages are signed INT columns. */
const MAX_INT = 2_147_483_647;

export interface XpImportRow {
  guildId: string;
  userId: string;
  xp: number;
  level: number;
  messages: number;
}

/** The three queries the writer needs; the default runs them on a transaction's EntityManager. */
export interface XpImportStore {
  /** The ids in `userIds` that already have an XPUser row in this guild. */
  existingUserIds(guildId: string, userIds: string[]): Promise<Set<string>>;
  /** Insert rows, leaving any (guildId, userId) that appeared meanwhile untouched. */
  insertNew(rows: XpImportRow[]): Promise<void>;
  /** Insert rows, or replace xp / level / messages on an existing (guildId, userId). */
  upsert(rows: XpImportRow[]): Promise<void>;
}

export type XpImportTransaction = <T>(work: (store: XpImportStore) => Promise<T>) => Promise<T>;

function managerStore(manager: EntityManager): XpImportStore {
  const repo = manager.getRepository(XPUser);
  return {
    async existingUserIds(guildId, userIds) {
      const rows = await repo.find({ select: { userId: true }, where: { guildId, userId: In(userIds) } });
      return new Set(rows.map(row => row.userId));
    },
    async insertNew(rows) {
      await repo.createQueryBuilder().insert().into(XPUser).values(rows).orIgnore().execute();
    },
    async upsert(rows) {
      await repo.upsert(rows, ['guildId', 'userId']);
    },
  };
}

const defaultTransaction: XpImportTransaction = work =>
  AppDataSource.transaction(manager => work(managerStore(manager)));

function toInt(value: number): number {
  return Math.min(MAX_INT, Math.max(0, Math.floor(value)));
}

/**
 * Write (or, for a dry run, only count) imported XP. Throws on a database
 * error, which rolls the whole import back.
 */
export async function writeImportedXp(
  guildId: string,
  records: RawXpRecord[],
  options: { overwrite: boolean; dryRun: boolean },
  transaction: XpImportTransaction = defaultTransaction,
): Promise<{ written: number; skippedExisting: number }> {
  let written = 0;
  let skippedExisting = 0;
  if (records.length === 0) return { written, skippedExisting };

  await transaction(async store => {
    for (let i = 0; i < records.length; i += XP_WRITE_CHUNK_SIZE) {
      const rows = records.slice(i, i + XP_WRITE_CHUNK_SIZE).map(record => {
        const xp = toInt(record.xp);
        return { guildId, userId: record.userId, xp, level: calculateLevel(xp), messages: toInt(record.messageCount) };
      });

      let toWrite = rows;
      if (!options.overwrite) {
        const existing = await store.existingUserIds(
          guildId,
          rows.map(row => row.userId),
        );
        toWrite = rows.filter(row => !existing.has(row.userId));
        skippedExisting += rows.length - toWrite.length;
      }
      if (toWrite.length === 0) continue;

      if (!options.dryRun) {
        await (options.overwrite ? store.upsert(toWrite) : store.insertNew(toWrite));
      }
      written += toWrite.length;
    }
  });

  return { written, skippedExisting };
}

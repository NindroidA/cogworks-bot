/**
 * Atomic close-status transitions, shared by every close/archive path
 * (ticket + application, Discord button + internal API).
 *
 * The "already closed" guards in those paths are check-then-set: two
 * near-simultaneous closes can both pass the read. The flip here is the
 * arbiter — a conditional UPDATE where the loser sees affected=0 and bails
 * as a duplicate. The revert is conditional too: it only un-closes a row
 * that is still 'closed' (i.e. the close this caller owns), so a failed
 * close can never clobber a status a concurrent request wrote in between.
 */

import { Not } from 'typeorm';

/** Minimal structural slice of a TypeORM repository the flip needs. */
interface StatusRepo {
  update(
    criteria: Record<string, unknown>,
    partial: Record<string, unknown>,
  ): Promise<{ affected?: number | null } | undefined>;
}

/**
 * Atomically flip an entity to 'closed'. Returns false when a concurrent
 * close already won the race — the caller should treat that as a duplicate
 * and NOT proceed to archive. (A fake repo returning undefined counts as a
 * win: only an explicit affected=0 signals a lost race.)
 */
export async function claimClose(repo: StatusRepo, id: number, guildId: string): Promise<boolean> {
  const result = await repo.update({ id, guildId, status: Not('closed') }, { status: 'closed' });
  return result?.affected !== 0;
}

/**
 * Revert a failed close to its original status — conditionally, so it only
 * touches the row while it is still 'closed'. If a concurrent request has
 * already moved the status on (re-close, approve, workflow change), the
 * revert is a no-op instead of resurrecting stale state.
 */
export async function releaseClose(
  repo: StatusRepo,
  id: number,
  guildId: string,
  originalStatus: string,
): Promise<void> {
  await repo.update({ id, guildId, status: 'closed' }, { status: originalStatus });
}

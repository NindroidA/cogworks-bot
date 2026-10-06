/**
 * Snapshot dates — the UTC calendar day an AnalyticsSnapshot row belongs to.
 *
 * `AnalyticsSnapshot.date` is a MySQL DATE column without `utc: true`, so a
 * JS Date never reaches the database as the UTC day it was built from.
 * TypeORM writes a Date as the process's *local* calendar day, and mysql2
 * sends a Date in a lookup as a local DATETIME. On a host west of UTC,
 * `new Date('2026-10-06')` is stored as 2026-10-05, and a lookup by it
 * compares against '2026-10-05 19:00:00' and finds nothing.
 *
 * A 'YYYY-MM-DD' string passes through both unchanged (it is also what
 * TypeORM hydrates the column to), so every write and every date comparison
 * on snapshots goes through `snapshotDate(utcDateKey(...))`.
 */

/** The UTC calendar day of `at` as 'YYYY-MM-DD'. */
export function utcDateKey(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

/**
 * A 'YYYY-MM-DD' day as the value for `AnalyticsSnapshot.date` in writes and
 * where clauses. Typed as Date to match the entity; it stays a string at
 * runtime so the process time zone can't shift it.
 */
export function snapshotDate(dateStr: string): Date {
  return dateStr as unknown as Date;
}

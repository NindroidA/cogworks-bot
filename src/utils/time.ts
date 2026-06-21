/**
 * Small time primitives (unification roadmap, Phase A4).
 *
 * Consolidates two idioms repeated across the codebase:
 *   - the `new Promise(resolve => setTimeout(resolve, ms))` sleep, and
 *   - the `Math.floor(date.getTime() / 1000)` unix-seconds conversion that feeds
 *     Discord `<t:unix:style>` timestamps, cooldown stamps, and backoff delays.
 *
 * Duration *formatting* deliberately stays with its callers (transcript, ping,
 * status, healthMonitor, rateLimiter) — those take different input units and
 * granularity, so merging them would be lossy rather than DRY.
 */

/** Resolve after `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Whole unix seconds for a `Date` — the value Discord `<t:…>` timestamps expect. */
export function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/** Current time in whole unix seconds. */
export function nowUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * One repair at a time per guild. In-process is enough: the bot runs one
 * process without sharding, and `/bot-health repair` and the internal API
 * share this lock.
 */

const held = new Set<string>();

/** Thrown when a repair for the guild is already running. */
export class RepairBusyError extends Error {
  constructor(readonly guildId: string) {
    super(`A repair is already running for guild ${guildId}`);
    this.name = 'RepairBusyError';
  }
}

/**
 * Takes the guild's repair lock. Returns its release function, or null while
 * another repair holds it. Releasing twice is harmless, so a stale release can
 * never free a later holder's lock.
 */
export function tryLockGuildRepair(guildId: string): (() => void) | null {
  if (held.has(guildId)) return null;
  held.add(guildId);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held.delete(guildId);
  };
}

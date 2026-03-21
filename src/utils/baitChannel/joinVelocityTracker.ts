import { INTERVALS, JOIN_VELOCITY, MAX } from '../constants';

export class JoinVelocityTracker {
  private joinTimestamps: Map<string, number[]> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Record a join for a guild. Lazy-prunes if the array exceeds the threshold.
   */
  recordJoin(guildId: string): void {
    const now = Date.now();
    let timestamps = this.joinTimestamps.get(guildId);

    if (!timestamps) {
      timestamps = [];
      this.joinTimestamps.set(guildId, timestamps);
    }

    // Lazy-prune: if array is too large, remove entries older than JOIN_VELOCITY.MAX_WINDOW_MS
    if (timestamps.length >= MAX.JOIN_VELOCITY_ENTRIES) {
      const cutoff = now - JOIN_VELOCITY.MAX_WINDOW_MS;
      const pruned = timestamps.filter(ts => ts >= cutoff);
      this.joinTimestamps.set(guildId, pruned);
      timestamps = pruned;
    }

    timestamps.push(now);
  }

  /**
   * Check if a join burst is currently active for a guild.
   */
  isBurstActive(guildId: string, threshold: number, windowMs: number): boolean {
    return this.getJoinCount(guildId, windowMs) >= threshold;
  }

  /**
   * Get the number of joins within a time window for a guild.
   */
  getJoinCount(guildId: string, windowMs: number): number {
    const timestamps = this.joinTimestamps.get(guildId);
    if (!timestamps) return 0;

    const cutoff = Date.now() - windowMs;
    let count = 0;
    for (let i = timestamps.length - 1; i >= 0; i--) {
      if (timestamps[i] >= cutoff) {
        count++;
      } else {
        break; // timestamps are in order, so we can stop early
      }
    }
    return count;
  }

  /**
   * Remove stale timestamps from all guilds.
   */
  cleanup(): void {
    const cutoff = Date.now() - JOIN_VELOCITY.MAX_WINDOW_MS;
    for (const [guildId, timestamps] of this.joinTimestamps) {
      const filtered = timestamps.filter(ts => ts >= cutoff);
      if (filtered.length === 0) {
        this.joinTimestamps.delete(guildId);
      } else {
        this.joinTimestamps.set(guildId, filtered);
      }
    }
  }

  /**
   * Start the periodic cleanup interval (60s).
   */
  startCleanupInterval(): void {
    if (this.cleanupInterval) return;
    this.cleanupInterval = setInterval(() => this.cleanup(), INTERVALS.JOIN_VELOCITY_CLEANUP);
  }

  /** Number of guilds currently being tracked. */
  getTrackedGuildCount(): number {
    return this.joinTimestamps.size;
  }

  /** Total number of tracked timestamps across all guilds. */
  getMapSize(): number {
    let total = 0;
    for (const timestamps of this.joinTimestamps.values()) {
      total += timestamps.length;
    }
    return total;
  }

  /** Clear the cleanup interval and all tracked data. */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.joinTimestamps.clear();
  }
}

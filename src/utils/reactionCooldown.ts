/**
 * Shared per-user per-message cooldown for reaction event handlers.
 * Prevents rapid reaction spam by enforcing a minimum time between actions.
 *
 * The cleanup timer is started lazily on first use — constructing the class
 * at module-import time no longer kicks off a background interval. Call
 * `stop()` to shut down cleanly.
 */
export class ReactionCooldown {
  private cooldowns = new Map<string, number>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private readonly cleanupIntervalMs: number;

  constructor(
    private cooldownMs: number = 2000,
    cleanupIntervalMs: number = 15_000,
  ) {
    this.cleanupIntervalMs = cleanupIntervalMs;
  }

  private ensureCleanupStarted(): void {
    if (this.cleanupInterval) return;
    this.cleanupInterval = setInterval(() => {
      const cutoff = Date.now() - this.cooldownMs;
      for (const [key, timestamp] of this.cooldowns.entries()) {
        if (timestamp < cutoff) {
          this.cooldowns.delete(key);
        }
      }
    }, this.cleanupIntervalMs);
  }

  /** Returns true if the user is on cooldown (action should be skipped) */
  isOnCooldown(userId: string, messageId: string): boolean {
    this.ensureCleanupStarted();
    const key = `${userId}:${messageId}`;
    const lastTime = this.cooldowns.get(key);
    const now = Date.now();
    if (lastTime && now - lastTime < this.cooldownMs) return true;
    this.cooldowns.set(key, now);
    return false;
  }

  /** Stop the cleanup interval (call on shutdown). Idempotent. */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

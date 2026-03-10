/**
 * Shared per-user per-message cooldown for reaction event handlers.
 * Prevents rapid reaction spam by enforcing a minimum time between actions.
 */
export class ReactionCooldown {
  private cooldowns = new Map<string, number>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(
    private cooldownMs: number = 2000,
    cleanupIntervalMs: number = 15_000,
  ) {
    // Clean up expired entries periodically to prevent unbounded growth
    this.cleanupInterval = setInterval(() => {
      const cutoff = Date.now() - this.cooldownMs;
      for (const [key, timestamp] of this.cooldowns.entries()) {
        if (timestamp < cutoff) {
          this.cooldowns.delete(key);
        }
      }
    }, cleanupIntervalMs);
  }

  /** Returns true if the user is on cooldown (action should be skipped) */
  isOnCooldown(userId: string, messageId: string): boolean {
    const key = `${userId}:${messageId}`;
    const lastTime = this.cooldowns.get(key);
    const now = Date.now();
    if (lastTime && now - lastTime < this.cooldownMs) return true;
    this.cooldowns.set(key, now);
    return false;
  }

  /** Stop the cleanup interval (call on shutdown) */
  stop(): void {
    clearInterval(this.cleanupInterval);
  }
}

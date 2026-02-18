/**
 * Rate Limiting System
 *
 * Prevents abuse by limiting how often users/guilds can execute commands
 * Uses in-memory Map with automatic cleanup
 */

import { logger } from '../index';

/**
 * Rate limit entry with timestamp and count
 */
interface RateLimitEntry {
  count: number;
  resetTime: number;
}

/**
 * Rate limit configuration
 */
interface RateLimitConfig {
  maxAttempts: number;
  windowMs: number;
  message?: string;
}

/**
 * Rate limiter class for tracking and enforcing limits
 */
class RateLimiter {
  private limits: Map<string, RateLimitEntry> = new Map();
  private cleanupInterval: NodeJS.Timeout;
  private devModeLogged: boolean = false; // Only log dev mode bypass once

  constructor() {
    // Clean up expired entries every 5 minutes
    this.cleanupInterval = setInterval(
      () => {
        this.cleanup();
      },
      5 * 60 * 1000,
    );
  }

  /**
   * Check if an action is rate limited
   *
   * @param key - Unique identifier (userId, guildId, or combination)
   * @param config - Rate limit configuration
   * @returns Object with allowed status and optional message
   */
  public check(
    key: string,
    config: RateLimitConfig,
  ): { allowed: boolean; message?: string; resetIn?: number } {
    // Check if we're in dev mode - bypass rate limits
    const RELEASE = (process.env.RELEASE || 'prod').toLowerCase().trim();
    if (RELEASE === 'dev') {
      // Only log once per session to avoid spam
      if (!this.devModeLogged) {
        logger('⚠️ Rate limiter running in dev mode - all limits bypassed', 'INFO');
        this.devModeLogged = true;
      }
      return { allowed: true };
    }

    const now = Date.now();
    const entry = this.limits.get(key);

    // No existing entry - allow and create new
    if (!entry) {
      this.limits.set(key, {
        count: 1,
        resetTime: now + config.windowMs,
      });
      return { allowed: true };
    }

    // Entry expired - reset and allow
    if (now >= entry.resetTime) {
      this.limits.set(key, {
        count: 1,
        resetTime: now + config.windowMs,
      });
      return { allowed: true };
    }

    // Entry exists and not expired - check count
    if (entry.count >= config.maxAttempts) {
      const resetIn = Math.ceil((entry.resetTime - now) / 1000);
      return {
        allowed: false,
        message: config.message || `Rate limit exceeded. Try again in ${this.formatTime(resetIn)}.`,
        resetIn,
      };
    }

    // Increment count and allow
    entry.count++;
    this.limits.set(key, entry);
    return { allowed: true };
  }

  /**
   * Reset rate limit for a specific key
   *
   * @param key - Unique identifier to reset
   */
  public reset(key: string): void {
    this.limits.delete(key);
    logger(`Rate limit reset for key: ${key}`, 'INFO');
  }

  /**
   * Get remaining attempts for a key
   *
   * @param key - Unique identifier
   * @param maxAttempts - Maximum attempts allowed
   * @returns Number of remaining attempts
   */
  public getRemaining(key: string, maxAttempts: number): number {
    const entry = this.limits.get(key);
    if (!entry || Date.now() >= entry.resetTime) {
      return maxAttempts;
    }
    return Math.max(0, maxAttempts - entry.count);
  }

  /**
   * Get time until reset for a key
   *
   * @param key - Unique identifier
   * @returns Seconds until reset, or 0 if not limited
   */
  public getResetTime(key: string): number {
    const entry = this.limits.get(key);
    if (!entry) return 0;

    const now = Date.now();
    if (now >= entry.resetTime) return 0;

    return Math.ceil((entry.resetTime - now) / 1000);
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.limits.entries()) {
      if (now >= entry.resetTime) {
        this.limits.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      logger(`Rate limiter cleanup: removed ${removed} expired entries`, 'INFO');
    }
  }

  /**
   * Format seconds into human-readable time
   *
   * @param seconds - Seconds to format
   * @returns Formatted string
   */
  private formatTime(seconds: number): string {
    if (seconds < 60) {
      return `${seconds} second${seconds !== 1 ? 's' : ''}`;
    }

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (remainingMinutes === 0) {
      return `${hours} hour${hours !== 1 ? 's' : ''}`;
    }

    return `${hours} hour${hours !== 1 ? 's' : ''} and ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}`;
  }

  /**
   * Stop the cleanup interval
   */
  public destroy(): void {
    clearInterval(this.cleanupInterval);
  }

  /**
   * Get current stats for monitoring
   */
  public getStats(): { activeEntries: number; totalLimits: number } {
    const now = Date.now();
    let active = 0;

    for (const entry of this.limits.values()) {
      if (now < entry.resetTime) {
        active++;
      }
    }

    return {
      activeEntries: active,
      totalLimits: this.limits.size,
    };
  }
}

// Singleton instance
export const rateLimiter = new RateLimiter();

/**
 * Predefined rate limit configurations
 */
export const RateLimits = {
  // Per-user command limits
  TICKET_CREATE: {
    maxAttempts: 3,
    windowMs: 60 * 60 * 1000, // 1 hour
    message:
      '⏱️ You can only create 3 tickets per hour. Please wait before creating another ticket.',
  },

  APPLICATION_CREATE: {
    maxAttempts: 2,
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    message:
      '⏱️ You can only submit 2 applications per day. Please wait before submitting another application.',
  },

  ANNOUNCEMENT_CREATE: {
    maxAttempts: 5,
    windowMs: 60 * 60 * 1000, // 1 hour
    message:
      '⏱️ You can only create 5 announcements per hour. Please wait before creating another announcement.',
  },

  ROLE_SAVE: {
    maxAttempts: 10,
    windowMs: 60 * 60 * 1000, // 1 hour
    message: '⏱️ You can only save roles 10 times per hour. Please wait before saving roles again.',
  },

  // Per-guild admin limits
  BOT_SETUP: {
    maxAttempts: 5,
    windowMs: 60 * 60 * 1000, // 1 hour
    message:
      '⏱️ Bot setup can only be modified 5 times per hour. Please wait before making more changes.',
  },

  DATA_EXPORT: {
    maxAttempts: 1,
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    message:
      '⏱️ Data export can only be requested once per day. Please wait before exporting again.',
  },

  TICKET_SETUP: {
    maxAttempts: 10,
    windowMs: 60 * 60 * 1000, // 1 hour
    message:
      '⏱️ Ticket setup can only be modified 10 times per hour. Please wait before making more changes.',
  },

  APPLICATION_SETUP: {
    maxAttempts: 10,
    windowMs: 60 * 60 * 1000, // 1 hour
    message:
      '⏱️ Application setup can only be modified 10 times per hour. Please wait before making more changes.',
  },

  APPLICATION_POSITION: {
    maxAttempts: 15,
    windowMs: 60 * 60 * 1000, // 1 hour
    message:
      '⏱️ Position management can only be modified 15 times per hour. Please wait before making more changes.',
  },

  ANNOUNCEMENT_SETUP: {
    maxAttempts: 5,
    windowMs: 60 * 60 * 1000, // 1 hour
    message:
      '⏱️ Announcement setup can only be modified 5 times per hour. Please wait before making more changes.',
  },

  BAIT_CHANNEL: {
    maxAttempts: 10,
    windowMs: 60 * 60 * 1000, // 1 hour
    message:
      '⏱️ Bait channel commands can only be used 10 times per hour. Please wait before making more changes.',
  },

  MEMORY_OPERATION: {
    maxAttempts: 20,
    windowMs: 60 * 60 * 1000, // 1 hour
    message:
      '⏱️ Memory operations can only be performed 20 times per hour. Please wait before making more changes.',
  },

  // Global limits (per user across all guilds)
  GLOBAL_COMMAND: {
    maxAttempts: 30,
    windowMs: 60 * 1000, // 1 minute
    message: '⏱️ You are sending commands too quickly. Please slow down.',
  },
} as const;

/**
 * Helper function to create rate limit keys
 */
export const createRateLimitKey = {
  /**
   * Create key for user-specific limit
   */
  user: (userId: string, action: string): string => {
    return `user:${userId}:${action}`;
  },

  /**
   * Create key for guild-specific limit
   */
  guild: (guildId: string, action: string): string => {
    return `guild:${guildId}:${action}`;
  },

  /**
   * Create key for user within guild
   */
  userGuild: (userId: string, guildId: string, action: string): string => {
    return `user:${userId}:guild:${guildId}:${action}`;
  },

  /**
   * Create key for global user limit
   */
  globalUser: (userId: string): string => {
    return `global:user:${userId}`;
  },
};

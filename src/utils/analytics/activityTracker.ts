/**
 * Activity Tracker — In-memory counters per guild per day.
 *
 * Lightweight, privacy-first: only aggregate counts are stored.
 * Called from event handlers (messageCreate, voiceStateUpdate, guildMemberAdd/Remove).
 * Data is flushed to AnalyticsSnapshot once daily by the snapshot job.
 */

import { AppDataSource } from '../../typeorm';
import { AnalyticsSnapshot } from '../../typeorm/entities/analytics/AnalyticsSnapshot';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';

interface GuildDayCounters {
  messageCount: number;
  /** Set of unique user IDs who sent messages */
  activeMembers: Set<string>;
  /** Channel ID -> message count */
  channelCounts: Map<string, { name: string; count: number }>;
  /** Hour (0-23) -> message count */
  hourCounts: Map<number, number>;
  voiceMinutes: number;
  memberJoined: number;
  memberLeft: number;
}

/**
 * Creates a fresh set of counters for a guild-day.
 */
function createCounters(): GuildDayCounters {
  return {
    messageCount: 0,
    activeMembers: new Set(),
    channelCounts: new Map(),
    hourCounts: new Map(),
    voiceMinutes: 0,
    memberJoined: 0,
    memberLeft: 0,
  };
}

/**
 * Returns today's date string in YYYY-MM-DD format (UTC).
 */
function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

class ActivityTracker {
  /**
   * Map key: `${guildId}:${YYYY-MM-DD}`
   * Each entry holds the day's running counters.
   */
  private counters = new Map<string, GuildDayCounters>();

  private getCounters(guildId: string): GuildDayCounters {
    const key = `${guildId}:${todayKey()}`;
    let c = this.counters.get(key);
    if (!c) {
      c = createCounters();
      this.counters.set(key, c);
    }
    return c;
  }

  /**
   * Record a message event.
   * @param guildId  Guild snowflake
   * @param channelId  Channel where the message was sent
   * @param channelName  Human-readable channel name (for top-channels display)
   * @param userId  Author snowflake (for unique active member tracking)
   */
  recordMessage(guildId: string, channelId: string, channelName: string, userId: string): void {
    const c = this.getCounters(guildId);
    c.messageCount++;
    c.activeMembers.add(userId);

    // Channel counts
    const existing = c.channelCounts.get(channelId);
    if (existing) {
      existing.count++;
    } else {
      c.channelCounts.set(channelId, { name: channelName, count: 1 });
    }

    // Hour counts (UTC)
    const hour = new Date().getUTCHours();
    c.hourCounts.set(hour, (c.hourCounts.get(hour) ?? 0) + 1);
  }

  /** Record one voice minute for a guild (called from a periodic voice tick). */
  recordVoiceMinute(guildId: string): void {
    this.getCounters(guildId).voiceMinutes++;
  }

  /** Record a member join. */
  recordMemberJoin(guildId: string): void {
    this.getCounters(guildId).memberJoined++;
  }

  /** Record a member leave. */
  recordMemberLeave(guildId: string): void {
    this.getCounters(guildId).memberLeft++;
  }

  /**
   * Flush today's counters for a specific guild into an AnalyticsSnapshot row.
   * After flushing, the in-memory counters are removed.
   *
   * @param guildId  Guild snowflake
   * @param memberCount  Current total member count (from Guild.memberCount)
   */
  async flushSnapshot(guildId: string, memberCount: number): Promise<void> {
    const dateStr = todayKey();
    const key = `${guildId}:${dateStr}`;
    const c = this.counters.get(key);

    if (!c) {
      // No activity recorded — still write a snapshot with member count for growth tracking
      await this.upsertSnapshot(guildId, dateStr, createCounters(), memberCount);
      return;
    }

    await this.upsertSnapshot(guildId, dateStr, c, memberCount);
    this.counters.delete(key);
  }

  private async upsertSnapshot(
    guildId: string,
    dateStr: string,
    c: GuildDayCounters,
    memberCount: number,
  ): Promise<void> {
    const repo = AppDataSource.getRepository(AnalyticsSnapshot);

    // Top 5 channels by count
    const topChannels = [...c.channelCounts.entries()]
      .map(([channelId, { name, count }]) => ({ channelId, name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Peak hour
    let peakHourUtc: number | null = null;
    let peakCount = 0;
    for (const [hour, count] of c.hourCounts) {
      if (count > peakCount) {
        peakCount = count;
        peakHourUtc = hour;
      }
    }

    try {
      // Upsert: if a snapshot for this guild+date already exists, update it
      let snapshot = await repo.findOneBy({ guildId, date: new Date(dateStr) });

      if (snapshot) {
        snapshot.memberCount = memberCount;
        snapshot.memberJoined += c.memberJoined;
        snapshot.memberLeft += c.memberLeft;
        snapshot.messageCount += c.messageCount;
        snapshot.activeMembers = c.activeMembers.size || snapshot.activeMembers;
        snapshot.voiceMinutes += c.voiceMinutes;
        snapshot.topChannels = topChannels.length > 0 ? topChannels : snapshot.topChannels;
        snapshot.peakHourUtc = peakHourUtc ?? snapshot.peakHourUtc;
      } else {
        snapshot = repo.create({
          guildId,
          date: new Date(dateStr),
          memberCount,
          memberJoined: c.memberJoined,
          memberLeft: c.memberLeft,
          messageCount: c.messageCount,
          activeMembers: c.activeMembers.size,
          voiceMinutes: c.voiceMinutes,
          topChannels: topChannels.length > 0 ? topChannels : null,
          peakHourUtc,
        });
      }

      await repo.save(snapshot);
    } catch (error) {
      enhancedLogger.error('Failed to flush analytics snapshot', error as Error, LogCategory.DATABASE, {
        guildId,
        date: dateStr,
      });
    }
  }

  /**
   * Flush ALL guilds' counters for a given date key and remove them.
   * Used by the snapshot job at midnight UTC.
   *
   * @param guildMemberCounts  Map of guildId -> current member count
   */
  async flushAll(guildMemberCounts: Map<string, number>): Promise<void> {
    const dateStr = todayKey();

    for (const [key, _counters] of this.counters) {
      const [guildId, keyDate] = key.split(':');
      // Only flush entries for the current date (stale entries from previous days are cleaned)
      if (keyDate === dateStr || keyDate < dateStr) {
        const memberCount = guildMemberCounts.get(guildId) ?? 0;
        await this.flushSnapshot(guildId, memberCount);
      }
    }
  }

  /** Remove stale entries from previous days that were never flushed. */
  cleanStaleEntries(): void {
    const today = todayKey();
    for (const key of this.counters.keys()) {
      const keyDate = key.split(':')[1];
      if (keyDate < today) {
        this.counters.delete(key);
      }
    }
  }

  /** Check if there are any counters for a guild today (for testing). */
  hasCounters(guildId: string): boolean {
    return this.counters.has(`${guildId}:${todayKey()}`);
  }
}

/** Singleton activity tracker instance */
export const activityTracker = new ActivityTracker();

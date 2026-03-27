/**
 * Memory Watchdog
 *
 * Monitors heap usage and in-memory Map sizes to detect leaks early.
 * Logs warnings/criticals via enhancedLogger and optionally alerts
 * to a Discord status channel with rate-limited messaging.
 *
 * Usage:
 *   import { memoryWatchdog } from './utils';
 *   memoryWatchdog.trackMap('rateLimiter', () => rateLimiter.getSize());
 *   memoryWatchdog.setClient(client);
 *   memoryWatchdog.start();
 */

import type { Client, TextChannel } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { Colors } from '../colors';
import { enhancedLogger, LogCategory } from './enhancedLogger';

export interface MemoryWatchdogConfig {
  /** Heap usage percentage to trigger a warning (default: 85 prod, 90 dev) */
  heapWarnPct: number;
  /** Heap usage percentage to trigger a critical alert (default: 95 prod, 98 dev) */
  heapCritPct: number;
  /** Map size threshold to trigger a warning (default: 10000) */
  mapWarnSize: number;
  /** Check interval in milliseconds (default: 60000 = 1 minute) */
  checkIntervalMs: number;
  /** Minimum time between status channel alerts in ms (default: 900000 = 15 min) */
  alertCooldownMs: number;
}

export interface WatchdogMemoryStats {
  heapUsedMB: number;
  heapTotalMB: number;
  heapPct: number;
  rssMB: number;
  trackedMaps: Record<string, number>;
  timestamp: string;
}

export type ThresholdLevel = 'ok' | 'warn' | 'critical';

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export class MemoryWatchdog {
  private config: MemoryWatchdogConfig;
  private trackedMaps: Map<string, () => number> = new Map();
  private interval: ReturnType<typeof setInterval> | null = null;
  private client: Client | null = null;
  private lastAlertTime = 0;

  constructor(config?: Partial<MemoryWatchdogConfig>) {
    const isDev = (process.env.RELEASE || 'prod').toLowerCase().trim() === 'dev';

    // Dev bots have smaller heaps and higher baseline usage — use relaxed thresholds
    const defaultWarnPct = isDev ? 90 : 85;
    const defaultCritPct = isDev ? 98 : 95;

    this.config = {
      heapWarnPct: envInt('MEMORY_WARN_HEAP_PCT', config?.heapWarnPct ?? defaultWarnPct),
      heapCritPct: envInt('MEMORY_CRIT_HEAP_PCT', config?.heapCritPct ?? defaultCritPct),
      mapWarnSize: envInt('MEMORY_MAP_WARN_SIZE', config?.mapWarnSize ?? 10000),
      checkIntervalMs: config?.checkIntervalMs ?? 60_000,
      alertCooldownMs: config?.alertCooldownMs ?? 900_000,
    };
  }

  /**
   * Register a Map (or any sized collection) for monitoring.
   * @param name Human-readable name
   * @param sizeFn Callback that returns the current size
   */
  trackMap(name: string, sizeFn: () => number): void {
    this.trackedMaps.set(name, sizeFn);
  }

  /**
   * Unregister a previously tracked Map.
   */
  untrackMap(name: string): void {
    this.trackedMaps.delete(name);
  }

  /**
   * Returns a point-in-time snapshot of memory and Map sizes.
   */
  getStats(): WatchdogMemoryStats {
    const mem = process.memoryUsage();
    const heapUsedMB = mem.heapUsed / 1024 / 1024;
    // Use heap_size_limit (max V8 can grow to) instead of heapTotal (current allocation)
    // heapTotal is misleading because V8 expands dynamically — 95% of current allocation is normal
    const v8Stats = require('node:v8').getHeapStatistics();
    const heapTotalMB = (v8Stats.heap_size_limit || mem.heapTotal) / 1024 / 1024;

    const trackedMaps: Record<string, number> = {};
    for (const [name, sizeFn] of this.trackedMaps) {
      try {
        trackedMaps[name] = sizeFn();
      } catch {
        trackedMaps[name] = -1;
      }
    }

    return {
      heapUsedMB: Math.round(heapUsedMB * 100) / 100,
      heapTotalMB: Math.round(heapTotalMB * 100) / 100,
      heapPct: Math.round((heapUsedMB / heapTotalMB) * 10000) / 100,
      rssMB: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
      trackedMaps,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Evaluate current stats against configured thresholds.
   * Logs warnings/criticals and returns the highest severity level.
   */
  checkThresholds(): ThresholdLevel {
    const stats = this.getStats();
    let level: ThresholdLevel = 'ok';

    // Heap percentage checks
    if (stats.heapPct >= this.config.heapCritPct) {
      level = 'critical';
      enhancedLogger.critical('Heap usage critical', undefined, LogCategory.SYSTEM, {
        heapPct: stats.heapPct,
        heapUsedMB: stats.heapUsedMB,
        heapTotalMB: stats.heapTotalMB,
        threshold: this.config.heapCritPct,
      });
    } else if (stats.heapPct >= this.config.heapWarnPct) {
      level = 'warn';
      enhancedLogger.warn('Heap usage elevated', LogCategory.SYSTEM, {
        heapPct: stats.heapPct,
        heapUsedMB: stats.heapUsedMB,
        heapTotalMB: stats.heapTotalMB,
        threshold: this.config.heapWarnPct,
      });
    }

    // Map size checks
    for (const [name, size] of Object.entries(stats.trackedMaps)) {
      if (size >= this.config.mapWarnSize) {
        if (level === 'ok') level = 'warn';
        enhancedLogger.warn(`Map "${name}" exceeds size threshold`, LogCategory.SYSTEM, {
          mapName: name,
          size,
          threshold: this.config.mapWarnSize,
        });
      }
    }

    // Status channel alerting (rate-limited)
    if (level !== 'ok') {
      void this.sendStatusChannelAlert(stats, level);
    }

    return level;
  }

  /**
   * Set the Discord client for status channel alerts.
   */
  setClient(client: Client): void {
    this.client = client;
  }

  private async sendStatusChannelAlert(stats: WatchdogMemoryStats, level: ThresholdLevel): Promise<void> {
    const channelId = process.env.MEMORY_ALERT_CHANNEL_ID || process.env.STATUS_CHANNEL_ID;
    const isDev = (process.env.RELEASE || 'prod').toLowerCase().trim() === 'dev';
    if (!channelId || !this.client || isDev) return;

    // Rate limit: skip if cooldown has not elapsed
    const now = Date.now();
    if (now - this.lastAlertTime < this.config.alertCooldownMs) return;
    this.lastAlertTime = now;

    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !('send' in channel)) return;

      const color = level === 'critical' ? Colors.severity.critical : Colors.severity.medium;

      const mapLines = Object.entries(stats.trackedMaps)
        .map(([name, size]) => {
          const warn = size >= this.config.mapWarnSize ? ' (!)' : '';
          return `\`${name}\`: ${size.toLocaleString()}${warn}`;
        })
        .join('\n');

      const embed = new EmbedBuilder()
        .setTitle(`Memory ${level === 'critical' ? 'Critical' : 'Warning'}`)
        .setColor(color)
        .addFields(
          {
            name: 'Heap',
            value: `${stats.heapUsedMB} / ${stats.heapTotalMB} MB (${stats.heapPct}%)`,
            inline: true,
          },
          { name: 'RSS', value: `${stats.rssMB} MB`, inline: true },
          { name: 'Tracked Maps', value: mapLines || 'None', inline: false },
        );
      await (channel as TextChannel).send({ embeds: [embed] });
    } catch (error) {
      enhancedLogger.error(
        'Failed to send memory watchdog alert to status channel',
        error as Error,
        LogCategory.SYSTEM,
      );
    }
  }

  /**
   * Start the periodic threshold check.
   */
  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => {
      this.checkThresholds();
    }, this.config.checkIntervalMs);

    enhancedLogger.info('Memory watchdog started', LogCategory.SYSTEM, {
      checkIntervalMs: this.config.checkIntervalMs,
      heapWarnPct: this.config.heapWarnPct,
      heapCritPct: this.config.heapCritPct,
      mapWarnSize: this.config.mapWarnSize,
    });
  }

  /**
   * Stop the periodic threshold check.
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      enhancedLogger.info('Memory watchdog stopped', LogCategory.SYSTEM);
    }
  }

  /**
   * Get the current config (for testing/debugging).
   */
  getConfig(): MemoryWatchdogConfig {
    return { ...this.config };
  }
}

export const memoryWatchdog = new MemoryWatchdog();

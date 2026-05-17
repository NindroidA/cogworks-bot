/**
 * Cross-channel content-burst detector.
 *
 * Catches a specific raid pattern that's invisible to per-channel
 * suspicion scoring: the same message content posted in N distinct
 * channels within M seconds. Either a copy-paste raider hitting every
 * #general-style channel, OR a compromised webhook spamming embeds.
 *
 * Implementation: per-user sliding window of `(contentHash, channelId,
 * timestamp)`. When `recordMessage` is called, prune old entries, append
 * the new one, and check the distinct channel count for the same hash
 * within the window.
 *
 * Storage cost: O(M × U) where U is concurrent active users. The 50-
 * entry per-user cap bounds memory under sustained attack. A 30s default
 * window means a guild with 1000 active users has ~50,000 records at
 * steady state — well within Node's heap.
 *
 * The detector is consulted from `baitChannelManager.handleMessage` for
 * every message in a guild that has bait channels configured — even
 * non-bait channels. A cross-channel burst signal raises suspicion score
 * by 30 (forces escalation into the bait path even from non-bait posts)
 * and feeds the `raidModeManager` for collective response.
 */

import { createHash } from 'node:crypto';

const MAX_ENTRIES_PER_USER = 50;
const CLEANUP_INTERVAL_MS = 30_000;

interface Entry {
  contentHash: string;
  channelId: string;
  at: number;
}

export interface BurstResult {
  bursting: boolean;
  distinctChannels: number;
  contentHash: string;
}

/**
 * Normalize content for hashing: lowercase, collapse whitespace, strip
 * Discord mentions / channel tags / role mentions / custom emoji. Two
 * messages that differ only in `<@123>` vs `<@456>` hash the same.
 */
function normalizeContent(content: string): string {
  return content
    .toLowerCase()
    .replace(/<@!?\d+>/g, '')
    .replace(/<#\d+>/g, '')
    .replace(/<@&\d+>/g, '')
    .replace(/<a?:\w+:\d+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashContent(content: string): string {
  return createHash('sha1').update(normalizeContent(content)).digest('hex');
}

export class ContentBurstDetector {
  private byUser: Map<string, Entry[]> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.cleanupInterval) return;
    this.cleanupInterval = setInterval(() => this.prune(), CLEANUP_INTERVAL_MS);
  }

  stop(): void {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    this.cleanupInterval = null;
  }

  /**
   * Record a message and return whether it bursting the window.
   * `windowSeconds` and `threshold` come from `BaitChannelConfig` — the
   * detector itself stays config-free so per-guild tuning is honored.
   */
  recordMessage(
    userId: string,
    channelId: string,
    content: string,
    windowSeconds: number,
    threshold: number,
  ): BurstResult {
    const now = Date.now();
    const cutoff = now - windowSeconds * 1000;
    const contentHash = hashContent(content);

    const userEntries = this.byUser.get(userId) ?? [];

    // Prune old entries before appending — keeps the per-user array small.
    let writeIdx = 0;
    for (let i = 0; i < userEntries.length; i++) {
      if (userEntries[i].at >= cutoff) {
        userEntries[writeIdx++] = userEntries[i];
      }
    }
    userEntries.length = writeIdx;

    userEntries.push({ contentHash, channelId, at: now });

    // Defensive cap — even under sustained attack we don't need history.
    if (userEntries.length > MAX_ENTRIES_PER_USER) {
      userEntries.splice(0, userEntries.length - MAX_ENTRIES_PER_USER);
    }

    this.byUser.set(userId, userEntries);

    // Count distinct channels for THIS hash in the window.
    const distinctChannels = new Set<string>();
    for (const entry of userEntries) {
      if (entry.contentHash === contentHash) {
        distinctChannels.add(entry.channelId);
      }
    }

    return {
      bursting: distinctChannels.size >= threshold,
      distinctChannels: distinctChannels.size,
      contentHash,
    };
  }

  /** Periodic sweep — drops users with no recent activity. */
  private prune(): void {
    const cutoff = Date.now() - 5 * 60 * 1000; // 5min idle → forget
    for (const [userId, entries] of this.byUser.entries()) {
      const latest = entries[entries.length - 1]?.at ?? 0;
      if (latest < cutoff) {
        this.byUser.delete(userId);
      }
    }
  }

  /** Test-only — clears state. */
  clear(): void {
    this.byUser.clear();
  }
}

// Module-level singleton; manager wires it up.
let _instance: ContentBurstDetector | null = null;

export function initContentBurstDetector(): ContentBurstDetector {
  _instance = new ContentBurstDetector();
  _instance.start();
  return _instance;
}

export function getContentBurstDetector(): ContentBurstDetector | null {
  return _instance;
}

export function stopContentBurstDetector(): void {
  _instance?.stop();
  _instance = null;
}

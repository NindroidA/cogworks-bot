/**
 * Raid Mode — sticky guild-wide lockdown triggered when N bait actions
 * fire within M seconds.
 *
 * The detection layer in `baitChannelManager` already catches individual
 * raid bots one at a time. Raid Mode is the *collective* response: when
 * multiple actions stack rapidly, the guild is almost certainly under
 * coordinated attack and per-user enforcement won't keep up. Locking
 * down `@everyone SendMessages: false` on non-staff channels buys the
 * mods time to manually triage.
 *
 * Sticky semantics: once entered, raid mode stays active until a mod
 * manually releases it (`/baitchannel raid release`) or the 4-hour cap
 * elapses. Auto-release-on-quiet was considered and rejected — the
 * Wick precedent is that sticky+manual is safer; otherwise the bot
 * could un-lock during a brief raid pause and let through a second
 * wave.
 *
 * State surface:
 *   - In-memory: per-guild trigger timestamps (sliding window).
 *   - DB: `BaitChannelConfig.currentRaidModeUntil` is the source of
 *     truth — `null` means inactive; non-null means "active until this
 *     timestamp" (4h cap from entry). Bot restarts read this column to
 *     restore lockdown state.
 *   - BaitChannelLog: meta rows with `actionTaken='raid-mode-entered'`
 *     / `'raid-mode-released'` and `userId='SYSTEM'` track history. The
 *     entered row also persists the channel-permission snapshot.
 */

import {
  type ColorResolvable,
  EmbedBuilder,
  type Guild,
  type NonThreadGuildBasedChannel,
  PermissionFlagsBits,
  type TextChannel,
} from 'discord.js';
import { LessThanOrEqual, MoreThan, type Repository } from 'typeorm';
import type { BaitChannelConfig } from '../../typeorm/entities/bait/BaitChannelConfig';
import type { BaitChannelLog } from '../../typeorm/entities/bait/BaitChannelLog';
import { Colors } from '../colors';
import { ErrorCategory, ErrorSeverity, logError } from '../errorHandler';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import { toUnixSeconds } from '../time';
import { getBaitChannelIds } from './channelList';

/** Maximum duration of an auto-entered raid lockdown — admin must release earlier or wait. */
const RAID_MODE_MAX_DURATION_MS = 4 * 60 * 60 * 1000; // 4 hours

/** How often the auto-release sweep releases lockdowns past their cap. */
const AUTO_RELEASE_SWEEP_MS = 60 * 1000;

/** `currentRaidModeUntil` is a second-precision DATETIME; the persisted snapshot's `until` has milliseconds. */
const UNTIL_MATCH_TOLERANCE_MS = 2000;

interface TriggerRecord {
  userId: string;
  at: number;
}

/**
 * Each locked channel's prior `@everyone SendMessages` (true = allow, false =
 * deny, null = inherit). `complete` is false only when the snapshot was lost
 * (raid entered before 3.16.5) and rebuilt from already-locked channels: their
 * denies may be ours, so they're left out and fall back to inherit on release.
 */
interface LockdownSnapshot {
  priors: Map<string, boolean | null>;
  complete: boolean;
}

/** A manual release while the guild is unavailable (Discord outage): nothing was released. */
export class RaidModeGuildUnavailableError extends Error {
  constructor(guildId: string) {
    super(`Guild ${guildId} is unavailable (Discord outage), so raid mode was not released. Try again shortly.`);
    this.name = 'RaidModeGuildUnavailableError';
  }
}

export interface RaidModeManagerDeps {
  configRepo: Repository<BaitChannelConfig>;
  logRepo: Repository<BaitChannelLog>;
}

export class RaidModeManager {
  /** Per-guild sliding window of recent trigger timestamps (in-memory). */
  private triggers: Map<string, TriggerRecord[]> = new Map();

  /**
   * Per-guild snapshot of each locked channel's prior `@everyone SendMessages`
   * tri-state, captured BEFORE the lockdown edits so release restores EXACTLY
   * what was there instead of blindly clearing to inherit (which would wipe a
   * pre-existing explicit allow — common in deny-by-default servers). Also
   * persisted in the `raid-mode-entered` meta row, so a restart mid-raid
   * reloads it instead of reading back the bot's own denies.
   */
  private lockdownSnapshots: Map<string, LockdownSnapshot> = new Map();

  /** Per-guild tail of the enter/release/restore queue (see `serialize`). */
  private guildQueues: Map<string, Promise<unknown>> = new Map();

  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private deps: RaidModeManagerDeps) {}

  /**
   * Record a bait trigger. Returns true if this trigger caused us to
   * enter raid mode (so the caller can log/alert appropriately).
   *
   * The caller is `baitChannelManager.executeAction` — only call after
   * an action has actually executed (skip log-only, skip whitelisted,
   * skip test mode). Otherwise mod-config-test noise would flood raid
   * detection.
   */
  async recordTrigger(guild: Guild, userId: string, config: BaitChannelConfig): Promise<boolean> {
    if (!config.enableRaidMode) return false;

    // Append to sliding window.
    const window = config.raidModeWindowSeconds * 1000;
    const threshold = config.raidModeThreshold;
    const now = Date.now();
    const cutoff = now - window;

    const guildTriggers = this.triggers.get(guild.id) ?? [];
    guildTriggers.push({ userId, at: now });
    // Prune entries older than the window. Done in-place rather than
    // creating a new array to avoid GC pressure during a hot raid burst.
    while (guildTriggers.length > 0 && guildTriggers[0].at < cutoff) {
      guildTriggers.shift();
    }
    // Cap memory: even under sustained attack we don't need more than
    // ~1000 records per guild — the threshold check only needs the
    // window count, not the history.
    if (guildTriggers.length > 1000) {
      guildTriggers.splice(0, guildTriggers.length - 1000);
    }
    this.triggers.set(guild.id, guildTriggers);

    if (guildTriggers.length < threshold) return false;

    // Already in raid mode? Don't re-enter (would double-edit permissions).
    if (config.currentRaidModeUntil && config.currentRaidModeUntil.getTime() > now) {
      return false;
    }

    await this.enterRaidMode(guild, config, guildTriggers.slice());
    return true;
  }

  /**
   * Activate raid mode. Sets DB state, restricts non-staff channels,
   * pings the alert role.
   */
  async enterRaidMode(guild: Guild, config: BaitChannelConfig, recentTriggers?: TriggerRecord[]): Promise<void> {
    const until = new Date(Date.now() + RAID_MODE_MAX_DURATION_MS);
    // Set before any await so a concurrent `recordTrigger` holding this object doesn't enter twice.
    config.currentRaidModeUntil = until;

    await this.serialize(guild.id, async () => {
      // Non-null = our lockdown is still applied (cap passed, not yet released).
      const stored = await this.deps.configRepo.findOne({ where: { guildId: guild.id } });
      const lockedUntil = stored?.currentRaidModeUntil ?? null;

      // Persist FIRST so a partial failure (perms revoked, alert send fails)
      // still leaves the guild marked as in-raid-mode for the dashboard.
      await this.deps.configRepo.save(config);

      // Snapshot before any edit. Re-entering a still-applied lockdown keeps
      // the priors it holds instead of re-reading our own denies.
      const known = lockedUntil ? await this.knownSnapshot(guild.id, lockedUntil) : null;
      const snapshot = this.captureSnapshot(guild, config, known, lockedUntil !== null);
      this.lockdownSnapshots.set(guild.id, snapshot);

      // Audit row — also the durable copy of the snapshot, written before the edits.
      await this.writeMetaLog(guild, 'raid-mode-entered', {
        until,
        triggerCount: recentTriggers?.length ?? 0,
        lockdownSnapshot: { priors: Object.fromEntries(snapshot.priors), complete: snapshot.complete },
      });

      // Channel lockdown — deny SendMessages for @everyone on every text
      // channel EXCEPT the log channel (so mods can still coordinate
      // there). We don't touch staff-restricted channels (those already
      // deny @everyone).
      await this.lockChannels(guild, config, snapshot);
    });

    // Mod alert.
    await this.sendRaidAlert(guild, config, recentTriggers ?? [], until);

    enhancedLogger.warn(
      `Raid mode ENTERED for ${guild.name} (${guild.id}) until ${until.toISOString()}`,
      LogCategory.SECURITY,
      {
        guildId: guild.id,
        until: until.toISOString(),
        triggerCount: recentTriggers?.length ?? 0,
      },
    );
  }

  /**
   * Release raid mode. Restores channel permissions, then clears DB state
   * and writes the audit row, so a crash or shutdown mid-release
   * leaves the raid active for the next boot or sweep to finish.
   * `onlyIfExpired` (auto-release) re-checks the cap inside the guild queue,
   * so a raid re-entered meanwhile is left alone. It also returns false and
   * keeps the raid for the next sweep when no channel could be restored.
   * While the guild is unavailable (outage: empty channel cache, so every
   * channel would be skipped and the raid cleared with all of them still
   * locked) nothing is released: auto-release returns false, and a manual
   * release throws `RaidModeGuildUnavailableError`.
   */
  async releaseRaidMode(guild: Guild, releasedBy: string, reason?: string, onlyIfExpired = false): Promise<boolean> {
    return this.serialize(guild.id, async () => {
      const config = await this.deps.configRepo.findOne({
        where: { guildId: guild.id },
      });
      if (!config) return false;
      if (!config.currentRaidModeUntil) return false; // not active
      if (!guild.available) {
        if (onlyIfExpired) return false; // the next sweep retries
        throw new RaidModeGuildUnavailableError(guild.id);
      }
      if (onlyIfExpired && config.currentRaidModeUntil.getTime() > Date.now()) return false;

      const snapshot = await this.knownSnapshot(guild.id, config.currentRaidModeUntil);

      // Restore each channel's recorded prior. Without a complete snapshot,
      // lockable channels it doesn't cover fall back to inherit.
      const edits = new Map(snapshot?.priors);
      let fellBack = 0;
      for (const channel of snapshot?.complete ? [] : lockableChannels(guild, config)) {
        if (edits.has(channel.id)) continue;
        edits.set(channel.id, null);
        fellBack++;
      }
      if (fellBack > 0) {
        enhancedLogger.warn(
          `Raid-mode release for ${guild.id}: no channel-permission snapshot for ${fellBack} channel(s) (lost, e.g. raid entered before 3.16.5) — reset @everyone SendMessages to inherit. Verify any channel that needed an explicit allow or deny.`,
          LogCategory.SECURITY,
          { guildId: guild.id, channels: fellBack },
        );
      }
      const { updated, failed } = await this.editChannels(guild, false, edits);
      if (failed.length > 0) {
        // Nothing restored (ManageRoles revoked, Discord down): the sweep keeps it and retries.
        const retry = onlyIfExpired && updated === 0;
        enhancedLogger.warn(
          `Raid-mode release for ${guild.id}: could not restore @everyone SendMessages on ${failed.length} channel(s): ${failed.slice(0, 10).join(', ')}. ${retry ? 'Still active; the next sweep retries.' : 'Fix them by hand.'}`,
          LogCategory.SECURITY,
          { guildId: guild.id, failed },
        );
        if (retry) return false;
      }

      await this.deps.configRepo.update({ guildId: guild.id }, { currentRaidModeUntil: null });
      this.lockdownSnapshots.delete(guild.id);

      await this.writeMetaLog(guild, 'raid-mode-released', {
        releasedBy,
        reason,
      });

      enhancedLogger.info(`Raid mode RELEASED for ${guild.name} (${guild.id}) by ${releasedBy}`, LogCategory.SECURITY, {
        guildId: guild.id,
        releasedBy,
        reason,
      });

      return true;
    });
  }

  /** Release `guild` if its 4h cap has passed. */
  async checkAutoRelease(guild: Guild): Promise<void> {
    await this.releaseRaidMode(guild, 'system:auto-release', 'duration cap (4h) elapsed', true);
  }

  /**
   * Release every guild whose cap has passed. One guild failing doesn't stop
   * the rest, and a guild the bot can't fetch is retried on the next sweep.
   */
  async releaseExpired(releasedBy: string, reason = 'duration cap (4h) elapsed'): Promise<number> {
    const expired = await this.deps.configRepo.find({
      where: { currentRaidModeUntil: LessThanOrEqual(new Date()) },
    });
    let released = 0;
    for (const config of expired) {
      try {
        const guild = await this.fetchGuildSilent(config.guildId);
        if (guild && (await this.releaseRaidMode(guild, releasedBy, reason, true))) released++;
      } catch (error) {
        logError({
          category: ErrorCategory.DISCORD_API,
          severity: ErrorSeverity.MEDIUM,
          message: 'Raid-mode auto-release failed',
          error,
          context: { guildId: config.guildId },
        });
      }
    }
    return released;
  }

  /**
   * Enforce the 4h cap: every `intervalMs`, release guilds past it. Started by
   * `restoreActiveLockdowns` at boot; unref'd so it never holds up shutdown.
   */
  startAutoReleaseSweep(intervalMs = AUTO_RELEASE_SWEEP_MS): void {
    if (this.sweepTimer) return;
    let running = false;
    this.sweepTimer = setInterval(() => {
      if (running) return; // previous tick is still restoring a big guild
      running = true;
      this.releaseExpired('system:auto-release')
        .catch(error => {
          logError({
            category: ErrorCategory.DATABASE,
            severity: ErrorSeverity.MEDIUM,
            message: 'Raid-mode auto-release sweep failed',
            error,
          });
        })
        .finally(() => {
          running = false;
        });
    }, intervalMs);
    this.sweepTimer.unref();
  }

  /** Stop the sweep. Call at the start of shutdown so a tick can't begin a release mid-exit. */
  stopAutoReleaseSweep(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  /**
   * Boot-time recovery for guilds where `currentRaidModeUntil > now()`.
   * Re-applies the channel lockdown — if the bot crashed mid-`enterRaidMode`
   * (after DB write, before/during `lockChannels`), some channels
   * may have been left unlocked while the dashboard says "active". The
   * priors come from the persisted snapshot, never from the already-locked
   * channels, so a later release still restores what was there before.
   * Also starts the auto-release sweep.
   *
   * Called from `clientReady` in `src/index.ts` once per boot.
   */
  async restoreActiveLockdowns(): Promise<void> {
    this.startAutoReleaseSweep();
    // Expired during the offline window → auto-release.
    await this.releaseExpired('system:boot-cleanup', 'duration cap elapsed while offline');

    const configs = await this.deps.configRepo.find({
      where: { currentRaidModeUntil: MoreThan(new Date()) },
    });
    let restored = 0;
    for (const config of configs) {
      const until = config.currentRaidModeUntil;
      const guild = until ? await this.fetchGuildSilent(config.guildId) : null;
      if (!until || !guild) continue;
      await this.serialize(guild.id, async () => {
        // No persisted snapshot (raid entered before 3.16.5): every channel is
        // already locked by us, so only still-open channels have a real prior.
        const snapshot = (await this.knownSnapshot(guild.id, until)) ?? this.captureSnapshot(guild, config, null, true);
        this.lockdownSnapshots.set(guild.id, snapshot);
        await this.lockChannels(guild, config, snapshot);
      });
      restored++;
    }
    if (restored > 0) {
      enhancedLogger.warn(
        `Restored raid mode lockdown on ${restored} guild(s) after bot restart`,
        LogCategory.SECURITY,
        { count: restored },
      );
    }
  }

  /** Internal helper — config repo doesn't have a Discord client ref, so we need one from `enterRaidMode`'s usual call shape. */
  private fetchGuildSilent: (guildId: string) => Promise<Guild | null> = async () => null;

  /**
   * Wire the guild-fetcher (typically `client.guilds.fetch.bind(client.guilds)` from boot).
   * Separates the boot-time recovery and auto-release sweep from the per-call
   * paths that already have a Guild ref in scope.
   */
  setGuildFetcher(fetcher: (guildId: string) => Promise<Guild | null>): void {
    this.fetchGuildSilent = fetcher;
  }

  /**
   * Read-only state for the dashboard / API. Active until actually released:
   * past the cap, channels stay locked until the sweep (within a minute).
   */
  async getStatus(guildId: string): Promise<{
    active: boolean;
    until: Date | null;
    triggerCount: number;
    recentOffenderIds: string[];
  }> {
    const config = await this.deps.configRepo.findOne({ where: { guildId } });
    const triggers = this.triggers.get(guildId) ?? [];
    const window = (config?.raidModeWindowSeconds ?? 60) * 1000;
    const cutoff = Date.now() - window;
    const recent = triggers.filter(t => t.at >= cutoff);

    return {
      active: Boolean(config?.currentRaidModeUntil),
      until: config?.currentRaidModeUntil ?? null,
      triggerCount: recent.length,
      recentOffenderIds: [...new Set(recent.map(t => t.userId))],
    };
  }

  /**
   * Run enter / release / restore for one guild one at a time. The sweep, a
   * slash command, the API and a trigger can land at once, and an entry that
   * snapshots channels while a release is still restoring them would record
   * the bot's own denies as the priors.
   */
  private async serialize<T>(guildId: string, task: () => Promise<T>): Promise<T> {
    const run = (this.guildQueues.get(guildId) ?? Promise.resolve()).then(task);
    const tail = run.catch(() => undefined);
    this.guildQueues.set(guildId, tail);
    try {
      return await run;
    } finally {
      if (this.guildQueues.get(guildId) === tail) this.guildQueues.delete(guildId);
    }
  }

  /**
   * Record each lockable channel's current state as its prior, except channels
   * `known` already holds (they may carry our own deny by now). Locked with no
   * `known` snapshot, a deny may be ours: skip it and mark the snapshot incomplete.
   */
  private captureSnapshot(
    guild: Guild,
    config: BaitChannelConfig,
    known: LockdownSnapshot | null,
    alreadyLocked: boolean,
  ): LockdownSnapshot {
    const priors = new Map(known?.priors);
    const complete = known ? known.complete : !alreadyLocked;
    for (const channel of lockableChannels(guild, config)) {
      const current = readSendMessages(channel, guild.roles.everyone.id);
      if (!priors.has(channel.id) && (complete || current !== false)) priors.set(channel.id, current);
    }
    return { priors, complete };
  }

  /**
   * The snapshot of the lockdown that set `until`: in memory, or else the copy
   * persisted in its `raid-mode-entered` row. Null when neither exists (raid
   * entered before 3.16.5, or the row failed to write).
   */
  private async knownSnapshot(guildId: string, until: Date): Promise<LockdownSnapshot | null> {
    const inMemory = this.lockdownSnapshots.get(guildId);
    if (inMemory) return inMemory;
    try {
      const rows = await this.deps.logRepo.find({
        where: { guildId, actionTaken: 'raid-mode-entered' },
        order: { createdAt: 'DESC', id: 'DESC' },
        take: 5,
      });
      for (const row of rows) {
        const snapshot = parsePersistedSnapshot(row.messageContent, until);
        if (snapshot) return snapshot;
      }
    } catch (error) {
      const message = (error as Error).message;
      enhancedLogger.warn(`Failed to load raid-mode lockdown snapshot: ${message}`, LogCategory.SECURITY, { guildId });
    }
    return null;
  }

  /** Deny `@everyone SendMessages` on every snapshot channel that isn't exempt or already denied. */
  private async lockChannels(guild: Guild, config: BaitChannelConfig, snapshot: LockdownSnapshot): Promise<void> {
    const exempt = exemptChannelIds(config);
    const edits = new Map<string, boolean | null>();
    for (const channelId of snapshot.priors.keys()) {
      if (!exempt.has(channelId)) edits.set(channelId, false);
    }
    await this.editChannels(guild, true, edits);
  }

  /**
   * Set each channel's @everyone SendMessages overwrite. Only ever touches
   * the channel-level @everyone overwrite — never guild-scoped role
   * permissions.
   *
   * Best-effort: per-channel failures are logged but don't abort the
   * sweep. Returns the number edited and the `#name`s that failed.
   */
  private async editChannels(
    guild: Guild,
    lockdown: boolean,
    edits: Map<string, boolean | null>,
  ): Promise<{ updated: number; failed: string[] }> {
    const everyone = guild.roles.everyone;
    let updated = 0;
    const failed: string[] = [];

    for (const [channelId, value] of edits) {
      const channel = guild.channels.cache.get(channelId);
      if (!channel || !('permissionOverwrites' in channel)) continue; // deleted mid-raid
      // Already explicitly denied → nothing to change (snapshot preserves it).
      if (lockdown && readSendMessages(channel, everyone.id) === false) continue;
      try {
        await channel.permissionOverwrites.edit(everyone, { SendMessages: value });
        updated++;
      } catch (error) {
        // A failed restore on a channel already at its prior value isn't a failure: the
        // lock never landed there (hidden from the bot, or Manage Roles missing at entry).
        const unchanged = !lockdown && readSendMessages(channel, everyone.id) === value;
        if (!unchanged) failed.push(`#${channel.name}`);
        enhancedLogger.debug(`Raid-mode permission edit failed on #${channel.name}`, LogCategory.SECURITY, {
          guildId: guild.id,
          channelId,
          unchanged,
          error: (error as Error).message,
        });
      }
    }

    enhancedLogger.info(
      `Raid-mode permission sweep (${lockdown ? 'lock' : 'unlock'}) for ${guild.id}: ${updated} updated, ${failed.length} failed`,
      LogCategory.SECURITY,
      { guildId: guild.id, lockdown, updated, failed: failed.length },
    );
    return { updated, failed };
  }

  private async sendRaidAlert(
    guild: Guild,
    config: BaitChannelConfig,
    triggers: TriggerRecord[],
    until: Date,
  ): Promise<void> {
    if (!config.logChannelId) return;

    const logChannel = (await guild.channels.fetch(config.logChannelId).catch(() => null)) as TextChannel | null;
    if (!logChannel) return;

    const distinctUsers = [...new Set(triggers.map(t => t.userId))];
    const offenderList = distinctUsers
      .slice(0, 10)
      .map(id => `<@${id}>`)
      .join('\n');
    const overflow = distinctUsers.length > 10 ? `\n…and ${distinctUsers.length - 10} more` : '';

    const embed = new EmbedBuilder()
      .setColor(Colors.status.error as ColorResolvable)
      .setTitle('🚨 RAID MODE ACTIVATED')
      .setDescription(
        `Detected **${triggers.length} bait triggers** within ` +
          `**${config.raidModeWindowSeconds}s** — exceeded threshold of ` +
          `${config.raidModeThreshold}. Server is locked down until ` +
          `<t:${toUnixSeconds(until)}:f>.`,
      )
      .addFields(
        {
          name: 'Recent offenders',
          value: offenderList + overflow || 'none',
          inline: false,
        },
        {
          name: 'How to release',
          value: '`/baitchannel raid release` or use the dashboard.',
          inline: false,
        },
      )
      .setTimestamp(new Date());

    const content = config.raidModeAlertRoleId ? `<@&${config.raidModeAlertRoleId}> Raid detected!` : undefined;

    try {
      await logChannel.send({ content, embeds: [embed] });
    } catch (error) {
      logError({
        category: ErrorCategory.DISCORD_API,
        severity: ErrorSeverity.MEDIUM,
        message: 'Failed to send raid-mode alert embed',
        error,
        context: { guildId: guild.id, logChannelId: config.logChannelId },
      });
    }
  }

  private async writeMetaLog(
    guild: Guild,
    action: 'raid-mode-entered' | 'raid-mode-released',
    extras: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.deps.logRepo.save(
        this.deps.logRepo.create({
          guildId: guild.id,
          userId: 'SYSTEM',
          username: 'cogworks-system',
          channelId: '0',
          messageContent: JSON.stringify(extras),
          messageId: '0',
          actionTaken: action,
          accountAgeDays: 0,
          membershipMinutes: 0,
        }),
      );
    } catch (error) {
      if (action === 'raid-mode-entered') {
        // This row is the only durable copy of the lockdown snapshot.
        logError({
          category: ErrorCategory.DATABASE,
          severity: ErrorSeverity.HIGH,
          message:
            'Failed to save the raid-mode lockdown snapshot: if the bot restarts before release, locked channels fall back to inherit',
          error,
          context: { guildId: guild.id },
        });
        return;
      }
      enhancedLogger.warn(`Failed to write raid-mode meta log: ${(error as Error).message}`, LogCategory.SECURITY, {
        guildId: guild.id,
      });
    }
  }
}

/** Text channels a lockdown covers: everything with overwrites except the log, summary and bait channels. */
function lockableChannels(guild: Guild, config: BaitChannelConfig): NonThreadGuildBasedChannel[] {
  const exempt = exemptChannelIds(config);
  return [...guild.channels.cache.values()].filter(
    (ch): ch is NonThreadGuildBasedChannel => ch.isTextBased() && 'permissionOverwrites' in ch && !exempt.has(ch.id),
  );
}

function exemptChannelIds(config: BaitChannelConfig): Set<string> {
  return new Set<string>(
    [config.logChannelId, config.summaryChannelId, ...getBaitChannelIds(config)].filter(
      (v): v is string => typeof v === 'string',
    ),
  );
}

function readSendMessages(channel: NonThreadGuildBasedChannel, everyoneId: string): boolean | null {
  const ow = channel.permissionOverwrites.cache.get(everyoneId);
  if (ow?.allow.has(PermissionFlagsBits.SendMessages)) return true;
  if (ow?.deny.has(PermissionFlagsBits.SendMessages)) return false;
  return null;
}

/** The snapshot in a `raid-mode-entered` row, only if the row belongs to the raid that set `until`. */
function parsePersistedSnapshot(messageContent: string, until: Date): LockdownSnapshot | null {
  try {
    const row = JSON.parse(messageContent) as {
      until?: string;
      lockdownSnapshot?: { priors?: Record<string, unknown>; complete?: boolean };
    } | null;
    const priors = row?.lockdownSnapshot?.priors;
    const sameRaid = Math.abs(Date.parse(row?.until ?? '') - until.getTime()) <= UNTIL_MATCH_TOLERANCE_MS;
    if (!sameRaid || !priors || typeof priors !== 'object') return null;
    const map = new Map<string, boolean | null>();
    for (const [channelId, prior] of Object.entries(priors)) {
      if (prior === true || prior === false || prior === null) map.set(channelId, prior);
    }
    return { priors: map, complete: row?.lockdownSnapshot?.complete === true };
  } catch {
    return null;
  }
}

// Singleton — initialized in `src/index.ts` boot.
let _instance: RaidModeManager | null = null;

export function initRaidModeManager(deps: RaidModeManagerDeps): RaidModeManager {
  _instance = new RaidModeManager(deps);
  return _instance;
}

export function getRaidModeManager(): RaidModeManager | null {
  return _instance;
}

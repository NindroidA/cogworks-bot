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
 *     / `'raid-mode-released'` and `userId='SYSTEM'` track history.
 */

import { type ColorResolvable, EmbedBuilder, type Guild, PermissionFlagsBits, type TextChannel } from 'discord.js';
import type { Repository } from 'typeorm';
import type { BaitChannelConfig } from '../../typeorm/entities/bait/BaitChannelConfig';
import type { BaitChannelLog } from '../../typeorm/entities/bait/BaitChannelLog';
import { Colors } from '../colors';
import { ErrorCategory, ErrorSeverity, logError } from '../errorHandler';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';

/** Maximum duration of an auto-entered raid lockdown — admin must release earlier or wait. */
const RAID_MODE_MAX_DURATION_MS = 4 * 60 * 60 * 1000; // 4 hours

interface TriggerRecord {
  userId: string;
  at: number;
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
   * tri-state (true=explicit allow / false=explicit deny / null=inherit),
   * captured at lockdown so release restores EXACTLY what was there instead of
   * blindly clearing to inherit (which would wipe a pre-existing explicit
   * allow — common in deny-by-default servers). In-memory only: if the bot
   * restarts mid-raid the snapshot is lost and release falls back to `null` +
   * a warning (see applyChannelLockdown).
   */
  private lockdownSnapshots: Map<string, Map<string, boolean | null>> = new Map();

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

    // Persist FIRST so a partial failure (perms revoked, alert send fails)
    // still leaves the guild marked as in-raid-mode for the dashboard.
    config.currentRaidModeUntil = until;
    await this.deps.configRepo.save(config);

    // Audit row.
    await this.writeMetaLog(guild, 'raid-mode-entered', {
      until,
      triggerCount: recentTriggers?.length ?? 0,
    });

    // Channel lockdown — deny SendMessages for @everyone on every text
    // channel EXCEPT the log channel (so mods can still coordinate
    // there). We don't touch staff-restricted channels (those already
    // deny @everyone).
    await this.applyChannelLockdown(guild, config, true);

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
   * Manually release raid mode. Restores channel permissions, clears
   * DB state, writes audit row.
   */
  async releaseRaidMode(guild: Guild, releasedBy: string, reason?: string): Promise<boolean> {
    const config = await this.deps.configRepo.findOne({
      where: { guildId: guild.id },
    });
    if (!config) return false;
    if (!config.currentRaidModeUntil) return false; // not active

    config.currentRaidModeUntil = null;
    await this.deps.configRepo.save(config);

    await this.applyChannelLockdown(guild, config, false);

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
  }

  /**
   * Tick: auto-release any guild whose `currentRaidModeUntil` has passed.
   * Wired into the hourly cleanup tick from `src/index.ts` (Phase 10 will
   * fold this into the broader retention sweep).
   */
  async checkAutoRelease(guild: Guild): Promise<void> {
    const config = await this.deps.configRepo.findOne({
      where: { guildId: guild.id },
    });
    if (!config?.currentRaidModeUntil) return;
    if (config.currentRaidModeUntil.getTime() > Date.now()) return;

    await this.releaseRaidMode(guild, 'system:auto-release', 'duration cap (4h) elapsed');
  }

  /**
   * Boot-time recovery for guilds where `currentRaidModeUntil > now()`.
   * Re-applies the channel lockdown — if the bot crashed mid-`enterRaidMode`
   * (after DB write, before/during `applyChannelLockdown`), some channels
   * may have been left unlocked while the dashboard says "active". This
   * sweep is idempotent: re-applying the deny-overwrite on an
   * already-locked channel is a no-op at the Discord API level.
   *
   * Called from `clientReady` in `src/index.ts` once per boot.
   */
  async restoreActiveLockdowns(): Promise<void> {
    // Find all guilds with active raid mode. Repo query — small table,
    // typically < 1k rows.
    const configs = await this.deps.configRepo.find({});
    const now = Date.now();
    let restored = 0;
    for (const config of configs) {
      if (!config.currentRaidModeUntil) continue;
      if (config.currentRaidModeUntil.getTime() <= now) {
        // Expired during the offline window → auto-release.
        const guild = await this.fetchGuildSilent(config.guildId);
        if (guild) {
          await this.releaseRaidMode(guild, 'system:boot-cleanup', 'duration cap elapsed while offline');
        }
        continue;
      }
      const guild = await this.fetchGuildSilent(config.guildId);
      if (!guild) continue;
      await this.applyChannelLockdown(guild, config, true);
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
   * Separates the boot-time recovery from the per-call paths that already
   * have a Guild ref in scope.
   */
  setGuildFetcher(fetcher: (guildId: string) => Promise<Guild | null>): void {
    this.fetchGuildSilent = fetcher;
  }

  /** Read-only state for the dashboard / API. */
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
      active: Boolean(config?.currentRaidModeUntil && config.currentRaidModeUntil.getTime() > Date.now()),
      until: config?.currentRaidModeUntil ?? null,
      triggerCount: recent.length,
      recentOffenderIds: [...new Set(recent.map(t => t.userId))],
    };
  }

  /**
   * Apply or remove the @everyone SendMessages overwrite on non-log
   * text channels.
   *
   * On `lockdown=true` we snapshot each channel's PRIOR @everyone
   * SendMessages tri-state (allow / deny / inherit) and then explicitly
   * deny. On `lockdown=false` we RESTORE that snapshot exactly — so a
   * channel that had an explicit `@everyone SendMessages: true` before the
   * raid keeps it, instead of being flattened to `inherit` (which in a
   * deny-by-default server would leave it silently locked after release).
   * If no snapshot exists (bot restarted mid-raid) we fall back to `null`
   * (inherit) and warn. Only ever touches the channel-level @everyone
   * overwrite — never guild-scoped role permissions.
   *
   * Best-effort: per-channel failures are logged but don't abort the
   * sweep. Mods can manually fix stragglers if needed.
   */
  private async applyChannelLockdown(guild: Guild, config: BaitChannelConfig, lockdown: boolean): Promise<void> {
    const everyone = guild.roles.everyone;
    const exemptChannelIds = new Set<string>(
      [config.logChannelId, config.summaryChannelId, ...(config.channelIds ?? [])].filter(
        (v): v is string => typeof v === 'string',
      ),
    );

    const channels = guild.channels.cache.filter(
      ch => ch.isTextBased() && 'permissionOverwrites' in ch && !exemptChannelIds.has(ch.id),
    );

    // Lockdown: build a fresh snapshot. Release: read the one we stored.
    const snapshot = lockdown ? new Map<string, boolean | null>() : this.lockdownSnapshots.get(guild.id);

    let updated = 0;
    let failed = 0;
    let restoredFromSnapshot = 0;

    for (const channel of channels.values()) {
      if (!('permissionOverwrites' in channel)) continue;
      const channelId = (channel as { id: string }).id;
      const channelName = (channel as { name?: string }).name ?? channelId;
      try {
        if (lockdown) {
          // Capture prior @everyone SendMessages tri-state, then deny.
          const ow = channel.permissionOverwrites.cache.get(everyone.id);
          const prior: boolean | null = ow?.allow.has(PermissionFlagsBits.SendMessages)
            ? true
            : ow?.deny.has(PermissionFlagsBits.SendMessages)
              ? false
              : null;
          snapshot?.set(channelId, prior);
          // Already explicitly denied → nothing to change (snapshot preserves it).
          if (prior !== false) {
            await channel.permissionOverwrites.edit(everyone, {
              SendMessages: false,
            });
          }
        } else {
          // Restore the recorded tri-state; fall back to inherit if missing.
          const hasSnap = snapshot?.has(channelId) ?? false;
          if (hasSnap) restoredFromSnapshot++;
          const restore: boolean | null = hasSnap ? (snapshot?.get(channelId) ?? null) : null;
          await channel.permissionOverwrites.edit(everyone, {
            SendMessages: restore,
          });
        }
        updated++;
      } catch (error) {
        failed++;
        enhancedLogger.debug(`Raid-mode permission edit failed on #${channelName}`, LogCategory.SECURITY, {
          guildId: guild.id,
          channelId,
          error: (error as Error).message,
        });
      }
    }

    if (lockdown) {
      this.lockdownSnapshots.set(guild.id, snapshot ?? new Map());
    } else {
      if (channels.size > 0 && restoredFromSnapshot === 0) {
        enhancedLogger.warn(
          `Raid-mode release for ${guild.id}: no channel-permission snapshot (bot likely restarted mid-raid) — reset @everyone SendMessages to inherit on ${updated} channels. Verify any channel that needed an explicit allow.`,
          LogCategory.SECURITY,
          { guildId: guild.id },
        );
      }
      this.lockdownSnapshots.delete(guild.id);
    }

    enhancedLogger.info(
      `Raid-mode permission sweep (${lockdown ? 'lock' : 'unlock'}) for ${guild.id}: ${updated} updated, ${failed} failed`,
      LogCategory.SECURITY,
      { guildId: guild.id, lockdown, updated, failed },
    );
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
          `<t:${Math.floor(until.getTime() / 1000)}:f>.`,
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
      enhancedLogger.warn(`Failed to write raid-mode meta log: ${(error as Error).message}`, LogCategory.SECURITY, {
        guildId: guild.id,
      });
    }
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

export function clearRaidModeManager(): void {
  _instance = null;
}

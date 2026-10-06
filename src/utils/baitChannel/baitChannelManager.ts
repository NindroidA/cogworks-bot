import {
  ChannelType,
  type Client,
  type Collection,
  type ColorResolvable,
  DiscordAPIError,
  EmbedBuilder,
  type Guild,
  type GuildBasedChannel,
  type GuildMember,
  type Message,
  PermissionFlagsBits,
  SnowflakeUtil,
  type TextChannel,
} from 'discord.js';
import { Between, LessThan, type Repository } from 'typeorm';
import { AppDataSource } from '../../typeorm';
import type { BaitChannelConfig } from '../../typeorm/entities/bait/BaitChannelConfig';
import type { BaitChannelLog } from '../../typeorm/entities/bait/BaitChannelLog';
import type { BaitKeyword } from '../../typeorm/entities/bait/BaitKeyword';
import type { IdempotencyKey as IdempotencyKeyEntity } from '../../typeorm/entities/bait/IdempotencyKey';
import { JoinEvent } from '../../typeorm/entities/bait/JoinEvent';
import type { PendingAction as PendingActionEntity } from '../../typeorm/entities/bait/PendingAction';
import type { UserActivity } from '../../typeorm/entities/UserActivity';
import { Colors } from '../colors';
import { CACHE_TTL, INTERVALS } from '../constants';
import { createTtlCache } from '../database/configCache';
import { verifiedMessageDelete } from '../discord/verifiedDelete';
import { ErrorCategory, ErrorSeverity, logError } from '../errorHandler';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import { toUnixSeconds } from '../time';
import { truncateWithNotice } from '../validation/inputSanitizer';
import { buildAppealUrl } from './appealToken';
import { buildAuditReason, flagsTriggered } from './auditReason';
import { type BanExecutorAction, type BanExecutorResult, executeBanAction, fetchBanState } from './banExecutor';
import { getBaitChannelIds } from './channelList';
import { getContentBurstDetector } from './contentBurstDetector';
import type { JoinVelocityTracker } from './joinVelocityTracker';
import { getRaidModeManager } from './raidModeManager';
import { getRetryQueue } from './retryQueue';
import { analyzeUrls } from './urlAnalyzer';
import { analyzeUsername } from './usernameAnalyzer';

// Mirrors `BaitChannelLog.dmFailureReason` — kept in sync deliberately.
type DmFailureReason = 'closed' | 'no_shared_guild' | 'timeout' | 'unknown';
interface DmResult {
  sent: boolean;
  failureReason?: DmFailureReason;
}

/**
 * Map a DM-send error to a structured failure reason. Discord error codes:
 *   - 50007 = Cannot send messages to this user (DMs disabled, or no
 *     shared guild)
 *   - Custom `dm_timeout` → our own 5s race timeout
 * Anything else is `unknown` (logged but not bucketed for stats).
 */
function classifyDmFailure(error: unknown): DmFailureReason {
  if (error instanceof DiscordAPIError) {
    if (error.code === 50007) {
      // Discord doesn't distinguish "DMs closed" from "no shared guild" in
      // the error code. We bucket both as "closed" — the practical outcome
      // is the same (we can't reach them).
      return 'closed';
    }
    return 'unknown';
  }
  if (error instanceof Error && error.message === 'dm_timeout') {
    return 'timeout';
  }
  return 'unknown';
}

interface PurgeResult {
  totalDeleted: number;
  channelCount: number;
  error?: string;
}

interface PendingBan {
  guildId: string;
  userId: string;
  messageId: string;
  channelId: string;
  timestamp: number;
  timeoutId: NodeJS.Timeout;
  suspicionScore: number;
  warningMessageId?: string; // ID of the bot's warning reply
  /**
   * Live detection state. Entries restored from the DB after a restart have
   * none, and they never act (their timer only drops the row).
   */
  context?: {
    message: Message;
    member: GuildMember;
    analysis: SuspicionAnalysis;
    warningMessage: Message | null;
    /** The user was told "no real action will be taken", so nothing real ever is. */
    postedInTestMode: boolean;
  };
}

/**
 * How a grace entry is being settled when the member already left: whether
 * they are banned now (null when that couldn't be checked).
 */
interface LeaveState {
  banned: boolean | null;
}

/** Grace timers are keyed per guild, so an event in one guild can never touch another guild's timer. */
function graceKey(guildId: string, userId: string, messageId: string): string {
  return `${guildId}:${userId}:${messageId}`;
}

/** Longest single reason line in the detection-reasons field. */
const MAX_REASON_LINE = 200;

/**
 * The detection reasons as one embed field value. A reason can quote every
 * matched URL or keyword, so each line is capped and the whole value is kept
 * inside Discord's 1024-character field limit: past it, EmbedBuilder throws,
 * which drops the grace warning and its timer, or the log-channel embed.
 */
function formatDetectionReasons(reasons: string[]): string {
  const lines = reasons.map(r => `• ${r.length > MAX_REASON_LINE ? `${r.slice(0, MAX_REASON_LINE - 1)}…` : r}`);
  return truncateWithNotice(lines.join('\n'), 1024);
}

/**
 * True when the channel's last message predates `since`, so a user who joined
 * at `since` can't have posted there. Unknown last message → false (sweep it).
 */
function quietSince(channel: GuildBasedChannel, since: number): boolean {
  const lastId = 'lastMessageId' in channel ? channel.lastMessageId : null;
  return !!lastId && SnowflakeUtil.timestampFrom(lastId) < since;
}

interface SuspicionAnalysis {
  score: number;
  flags: {
    newAccount: boolean;
    newMember: boolean;
    noMessages: boolean;
    noVerification: boolean;
    suspiciousContent: boolean;
    linkSpam: boolean;
    mentionSpam: boolean;
    defaultAvatar: boolean;
    emptyProfile: boolean;
    suspiciousUsername: boolean;
    noRoles: boolean;
    discordInvite: boolean;
    phishingUrl: boolean;
    attachmentOnly: boolean;
    joinBurst: boolean;
    crossChannelBurst?: boolean;
  };
  reasons: string[];
}

interface BufferedActivity {
  messageCount: number;
  firstMessageAt: Date;
  lastMessageAt: Date;
  joinedAt: Date;
}

interface RepeatOffenderResult {
  matchCount: number;
  matchingUsers: { userId: string; joinedAt: Date; accountCreatedAt: Date }[];
}

export class BaitChannelManager {
  private pendingBans: Map<string, PendingBan> = new Map();
  /** Tail of each member's chain (`guildId:userId`), see inMemberChain. */
  private memberChains: Map<string, Promise<void>> = new Map();
  private configCache = createTtlCache<string, BaitChannelConfig>(CACHE_TTL.BAIT_CONFIG);
  private keywordCache = createTtlCache<string, BaitKeyword[]>(CACHE_TTL.BAIT_CONFIG);
  private activityBuffer: Map<string, BufferedActivity> = new Map();
  private activityFlushInterval: ReturnType<typeof setInterval> | null = null;
  private joinVelocityTracker: JoinVelocityTracker | null = null;

  constructor(
    private client: Client,
    private configRepo: Repository<BaitChannelConfig>,
    private logRepo: Repository<BaitChannelLog>,
    private activityRepo: Repository<UserActivity>,
    private pendingActionRepo?: Repository<PendingActionEntity>,
    private keywordRepo?: Repository<BaitKeyword>,
    private idempotencyRepo?: Repository<IdempotencyKeyEntity>,
  ) {}

  setJoinVelocityTracker(tracker: JoinVelocityTracker): void {
    this.joinVelocityTracker = tracker;
  }

  /**
   * Initialize: restore unexpired pending bans from DB and clean up expired ones.
   * Call after construction once the bot is ready.
   */
  async initialize(): Promise<void> {
    if (!this.pendingActionRepo) return;

    try {
      // Clean up expired entries
      await this.pendingActionRepo.delete({ expiresAt: LessThan(new Date()) });

      // Load unexpired pending bans and re-create timeouts
      const activeBans = await this.pendingActionRepo.find();
      for (const ban of activeBans) {
        const remainingMs = ban.expiresAt.getTime() - Date.now();
        if (remainingMs <= 0) {
          await this.pendingActionRepo.remove(ban);
          continue;
        }

        const key = graceKey(ban.guildId, ban.userId, ban.messageId);
        const timeoutId = setTimeout(async () => {
          this.pendingBans.delete(key);
          await this.removePendingBanFromDb(ban.userId, ban.messageId, ban.guildId);
        }, remainingMs);

        this.pendingBans.set(key, {
          guildId: ban.guildId,
          userId: ban.userId,
          messageId: ban.messageId,
          channelId: ban.channelId,
          timestamp: ban.createdAt.getTime(),
          timeoutId,
          suspicionScore: ban.suspicionScore,
          warningMessageId: ban.warningMessageId || undefined,
        });
      }

      if (activeBans.length > 0) {
        enhancedLogger.info(`Restored ${this.pendingBans.size} pending bans from database`, LogCategory.SYSTEM);
      }
    } catch (error) {
      logError({
        category: ErrorCategory.DATABASE,
        severity: ErrorSeverity.MEDIUM,
        message: 'Failed to restore pending bans from database',
        error,
        context: {},
      });
    }
  }

  // `action` is what the row would do if run: the resolved executor action,
  // or 'log-only' in test mode. Left unset, the column default is 'ban'.
  private async savePendingBanToDb(
    guildId: string,
    pendingBan: PendingBan,
    gracePeriodSeconds: number,
    action: BanExecutorAction,
  ): Promise<void> {
    if (!this.pendingActionRepo) return;
    try {
      const entity = this.pendingActionRepo.create({
        guildId,
        userId: pendingBan.userId,
        messageId: pendingBan.messageId,
        channelId: pendingBan.channelId,
        action,
        suspicionScore: pendingBan.suspicionScore,
        warningMessageId: pendingBan.warningMessageId || undefined,
        createdAt: new Date(pendingBan.timestamp),
        expiresAt: new Date(pendingBan.timestamp + gracePeriodSeconds * 1000),
      });
      await this.pendingActionRepo.save(entity);
    } catch (error) {
      logError({
        category: ErrorCategory.DATABASE,
        severity: ErrorSeverity.LOW,
        message: 'Failed to persist pending ban to database',
        error,
        context: { userId: pendingBan.userId, guildId },
      });
    }
  }

  // guildId is REQUIRED — an unscoped {userId, messageId} delete would cross
  // guild boundaries, and guild scoping is the project's data-isolation
  // invariant (CLAUDE.md Critical Rules), not an optional refinement.
  private async removePendingBanFromDb(userId: string, messageId: string, guildId: string): Promise<void> {
    if (!this.pendingActionRepo) return;
    try {
      await this.pendingActionRepo.delete({ userId, messageId, guildId });
    } catch (error) {
      logError({
        category: ErrorCategory.DATABASE,
        severity: ErrorSeverity.LOW,
        message: 'Failed to remove pending ban from database',
        error,
        context: { userId, messageId, guildId },
      });
    }
  }

  /**
   * Settle a user's grace periods in ONE guild when they leave it. Called
   * (and awaited) by `guildMemberRemove` before it drains retry rows; grace
   * rows (attempts = 0) belong to this manager and the drain skips them.
   *
   * Runs in the member's chain, so when our own ban or softban caused the
   * leave, that action finishes (and settles the other entries) first.
   *
   * A leave can be a ban by a mod or another bot, and a softban would lift
   * it, so the ban list is checked first: a banned user's entries end
   * without action. Otherwise a live entry resolves now, through the same
   * checks as an expired timer (fresh config, test mode, whitelist, message
   * still there), with timeout and kick becoming a softban since the member
   * is gone. A restored entry only loses its timer: restored entries never
   * act, and the retry queue's orphan sweep drops the row.
   */
  resolveGraceOnLeave(guildId: string, userId: string): Promise<void> {
    return this.inMemberChain(guildId, userId, async () => {
      const entries = [...this.pendingBans.entries()].filter(([, p]) => p.guildId === guildId && p.userId === userId);
      const guild = entries.find(([, p]) => p.context)?.[1].context?.message.guild;
      const banned = guild ? await fetchBanState(guild, userId) : null;
      for (const [key, pending] of entries) {
        clearTimeout(pending.timeoutId);
        if (pending.context) {
          await this.resolveGrace(key, 'Left during grace period', { banned });
        } else {
          this.pendingBans.delete(key);
        }
        enhancedLogger.debug(`Settled grace timer for ${userId} in ${guildId} (user left)`, LogCategory.SECURITY, {
          guildId,
          userId,
        });
      }
    });
  }

  /**
   * Run `task` after any earlier grace resolution or bait action for the same
   * member in the same guild has finished. Without this, two posts' timers
   * (or a timer and the leave our own softban causes) can act at once, and a
   * ban can land between a softban's ban and unban steps and be lifted.
   */
  private inMemberChain<T>(guildId: string, userId: string, task: () => Promise<T>): Promise<T> {
    const chainKey = `${guildId}:${userId}`;
    const run = (this.memberChains.get(chainKey) ?? Promise.resolve()).then(task);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.memberChains.set(chainKey, tail);
    void tail.then(() => {
      if (this.memberChains.get(chainKey) === tail) this.memberChains.delete(chainKey);
    });
    return run;
  }

  /**
   * Cancel one pending grace-period action (dashboard cancel). Stops the
   * in-memory timer and removes the bot's warning reply; the caller removes
   * the DB row afterwards. Returns false when no timer was pending (already
   * resolved, or the row is a retry-queue row).
   */
  async cancelPendingAction(guildId: string, userId: string, messageId: string): Promise<boolean> {
    const key = graceKey(guildId, userId, messageId);
    const pending = this.pendingBans.get(key);
    if (!pending) return false;
    clearTimeout(pending.timeoutId);
    this.pendingBans.delete(key);
    await this.deleteGraceWarning(pending);
    enhancedLogger.info(`Cancelled pending bait action for ${userId} in ${guildId}`, LogCategory.SECURITY, {
      guildId,
      userId,
      messageId,
    });
    return true;
  }

  /**
   * End a user's remaining grace periods in one guild without acting. Called
   * once a removal of that user (ban, kick, softban) has landed: left to run,
   * a later entry could lift that ban with a softban's unban step, or ban
   * someone just softbanned before that post's own window was over. So the
   * user is acted on once, by the entry that resolved first. Their posts are
   * deleted here, as each timer would have done: with deleteMessageHours 0 the
   * ban purges nothing. A post the purge already took is skipped quietly.
   */
  private async dropGraceForUser(guildId: string, userId: string): Promise<void> {
    const dropped = [...this.pendingBans.entries()].filter(([, p]) => p.guildId === guildId && p.userId === userId);
    for (const [key, pending] of dropped) {
      clearTimeout(pending.timeoutId);
      this.pendingBans.delete(key);
    }
    for (const [, pending] of dropped) {
      await this.removePendingBanFromDb(userId, pending.messageId, guildId);
      if (pending.context) {
        await verifiedMessageDelete(pending.context.message, { guildId, label: 'bait channel message' });
      }
      await this.deleteGraceWarning(pending);
    }
  }

  /** Delete the bot's warning reply for a grace entry (by reference, or by ID for restored entries). */
  private async deleteGraceWarning(pending: PendingBan): Promise<void> {
    if (!pending.warningMessageId) return;
    try {
      let warning = pending.context?.warningMessage ?? null;
      if (!warning) {
        const guild = this.client.guilds.cache.get(pending.guildId);
        const channel = (await guild?.channels.fetch(pending.channelId).catch(() => null)) as TextChannel | null;
        warning = (await channel?.messages.fetch(pending.warningMessageId).catch(() => null)) ?? null;
      }
      await warning?.delete();
    } catch (error) {
      logError({
        category: ErrorCategory.DISCORD_API,
        severity: ErrorSeverity.LOW,
        message: 'Failed to delete bait warning message',
        error,
        context: { warningMessageId: pending.warningMessageId, channelId: pending.channelId },
      });
    }
  }

  async handleMessage(message: Message): Promise<void> {
    try {
      if (!message.guild || message.author.bot || message.system) return;

      const config = await this.getConfig(message.guild.id);
      if (!config?.enabled) {
        enhancedLogger.debug(
          `Bait channel ${!config ? 'not configured' : 'disabled'} for guild ${message.guild.id}`,
          LogCategory.SYSTEM,
        );
        return;
      }

      // Multi-channel support: check channelIds array with legacy channelId fallback
      const baitChannels = getBaitChannelIds(config);
      if (!baitChannels.includes(message.channelId)) {
        enhancedLogger.debug(
          `Message in ${message.channelId}, bait channels are [${baitChannels.join(', ')}]`,
          LogCategory.SYSTEM,
        );
        return;
      }

      const member = message.member!;

      // Check whitelist (single lookup — reason and whitelisted status come together)
      const whitelist = this.checkWhitelist(member, config);
      if (whitelist.whitelisted) {
        // Still delete the message even for whitelisted users
        try {
          await message.delete();
        } catch (error) {
          logError({
            category: ErrorCategory.DISCORD_API,
            severity: ErrorSeverity.LOW,
            message: 'Failed to delete bait channel message from whitelisted user',
            error,
            context: { messageId: message.id, guildId: message.guild!.id },
          });
        }

        // Log to channel explaining they're whitelisted
        await this.logToChannelWhitelisted(member, message, config, whitelist.reason);

        // Log to database
        await this.logAction(message, member, 'whitelisted', config);
        return;
      }

      // Perform suspicion analysis
      const analysis = await this.analyzeSuspicion(message, config);

      // v3.2.0 — cross-channel content-burst boost. If this user has posted
      // the same content in N+ distinct channels within the burst window,
      // bump the score by 30 and flip the dedicated flag. Forces escalation
      // even from borderline single-message scores, and signals
      // raidModeManager that the trigger pool is heating up.
      const burstDetector = getContentBurstDetector();
      if (burstDetector) {
        const burst = burstDetector.recordMessage(
          message.guild.id,
          member.id,
          message.channelId,
          message.content,
          config.crossChannelBurstWindowSeconds ?? 30,
          config.crossChannelBurstThreshold ?? 3,
        );
        if (burst.bursting) {
          analysis.score = Math.min(100, analysis.score + 30);
          analysis.flags.crossChannelBurst = true;
          analysis.reasons.push(
            `Same content in ${burst.distinctChannels} channels within ${config.crossChannelBurstWindowSeconds ?? 30}s`,
          );
        }
      }

      // Log the attempt
      enhancedLogger.info(
        `Bait channel post from ${member.user.tag} (Score: ${analysis.score}/100)`,
        LogCategory.SECURITY,
        {
          userId: member.id,
          score: analysis.score,
          guildId: message.guild.id,
        },
      );

      // Instant action for high suspicion scores (configurable threshold, default 90)
      if (config.enableSmartDetection && analysis.score >= (config.instantActionThreshold ?? 90)) {
        await this.inMemberChain(message.guild.id, member.id, () =>
          this.executeAction(member, message, config, analysis, 'High suspicion score - instant action'),
        );
        return;
      }

      // Instant ban mode
      if (config.gracePeriodSeconds === 0) {
        await this.inMemberChain(message.guild.id, member.id, () =>
          this.executeAction(member, message, config, analysis, 'Instant action mode'),
        );
        return;
      }

      // Grace period mode
      await this.initiateGracePeriod(message, config, analysis);
    } catch (error) {
      logError({
        category: ErrorCategory.UNKNOWN,
        severity: ErrorSeverity.HIGH,
        message: 'Failed to handle bait channel message',
        error,
        context: {
          guildId: message.guild?.id,
          channelId: message.channelId,
          userId: message.author.id,
        },
      });
    }
  }

  private async analyzeSuspicion(message: Message, config: BaitChannelConfig): Promise<SuspicionAnalysis> {
    const member = message.member!;
    let score = 0;
    const flags = {
      newAccount: false,
      newMember: false,
      noMessages: false,
      noVerification: false,
      suspiciousContent: false,
      linkSpam: false,
      mentionSpam: false,
      defaultAvatar: false,
      emptyProfile: false,
      suspiciousUsername: false,
      noRoles: false,
      discordInvite: false,
      phishingUrl: false,
      attachmentOnly: false,
      joinBurst: false,
    };
    const reasons: string[] = [];

    // Check account age
    const accountAge = Date.now() - member.user.createdTimestamp;
    const accountAgeDays = accountAge / (1000 * 60 * 60 * 24);

    if (accountAgeDays < config.minAccountAgeDays) {
      flags.newAccount = true;
      const severity = config.minAccountAgeDays - accountAgeDays;
      score += Math.min(30, severity * 4); // Up to 30 points
      reasons.push(`New account (${accountAgeDays.toFixed(1)} days old)`);
    }

    // Check membership duration
    const membershipAge = Date.now() - member.joinedTimestamp!;
    const membershipMinutes = membershipAge / (1000 * 60);

    if (membershipMinutes < config.minMembershipMinutes) {
      flags.newMember = true;
      score += 25;
      reasons.push(`Just joined (${membershipMinutes.toFixed(1)} minutes ago)`);
    }

    // Check message history
    const userActivity = await this.activityRepo.findOne({
      where: { guildId: message.guild!.id, userId: member.id },
    });

    const messageCount = userActivity?.messageCount || 0;
    if (messageCount < config.minMessageCount) {
      flags.noMessages = true;
      score += 20;
      reasons.push(`Low message count (${messageCount} messages)`);
    }

    // Check for verification role
    if (config.requireVerification) {
      const hasVerifiedRole = member.roles.cache.some(
        role => role.name.toLowerCase().includes('verified') || role.name.toLowerCase().includes('member'),
      );

      if (!hasVerifiedRole) {
        flags.noVerification = true;
        score += 15;
        reasons.push('No verification role');
      }
    }

    // Check for default avatar (no custom profile picture)
    if (member.user.avatar === null) {
      flags.defaultAvatar = true;
      score += 10;
      reasons.push('Default avatar (no custom avatar set)');
    }

    // Check for no roles (only @everyone)
    if (member.roles.cache.size <= 1) {
      flags.noRoles = true;
      score += 10;
      reasons.push('No server roles assigned');
    }

    // Check for empty profile (no banner and default avatar) — requires API fetch
    try {
      const fetchedUser = await member.user.fetch(true);
      // No banner + default avatar = very likely a throwaway account
      if (fetchedUser.banner === null && fetchedUser.avatar === null) {
        flags.emptyProfile = true;
        score += 5;
        reasons.push('Empty profile (no banner, no avatar)');
      }
    } catch {
      // API fetch failed (rate limit, network) — skip this flag, never penalize
      enhancedLogger.debug(`Skipped emptyProfile check for ${member.user.tag} (fetch failed)`, LogCategory.SECURITY);
    }

    // Check for suspicious username patterns
    const usernameResult = analyzeUsername(member.user.username);
    if (usernameResult.isSuspicious) {
      flags.suspiciousUsername = true;
      score += 8;
      reasons.push(`Suspicious username patterns: ${usernameResult.patterns.join(', ')}`);
    }

    // Content analysis
    const content = message.content.toLowerCase();

    // URL analysis — categorize links by threat level
    const urlAnalysis = analyzeUrls(message.content);

    if (urlAnalysis.phishingLinks.length > 0) {
      flags.phishingUrl = true;
      score += Math.min(25, urlAnalysis.phishingLinks.length * 20);
      reasons.push(`Phishing URL detected: ${urlAnalysis.phishingLinks.join(', ')}`);
    }

    if (urlAnalysis.inviteLinks.length > 0) {
      flags.discordInvite = true;
      score += 15;
      reasons.push(`Contains Discord invite link(s)`);
    }

    if (urlAnalysis.shortenedLinks.length > 0) {
      flags.linkSpam = true;
      score += Math.min(20, urlAnalysis.shortenedLinks.length * 12);
      reasons.push(`Contains ${urlAnalysis.shortenedLinks.length} shortened URL(s)`);
    }

    if (urlAnalysis.regularLinks.length > 0) {
      flags.linkSpam = true;
      score += Math.min(20, urlAnalysis.regularLinks.length * 10);
      reasons.push(`Contains ${urlAnalysis.regularLinks.length} link(s)`);
    }

    // Check for attachment-only messages (no/minimal text)
    if (message.attachments.size > 0 && message.content.trim().length < 10) {
      flags.attachmentOnly = true;
      score += 5;
      reasons.push('Attachment-only message (minimal text)');
    }

    // Check for excessive mentions
    const mentions = message.mentions.users.size + message.mentions.roles.size;
    if (mentions > 3) {
      flags.mentionSpam = true;
      score += 15;
      reasons.push(`Excessive mentions (${mentions})`);
    }

    // Check for configurable spam keywords (per-guild, weighted)
    const keywords = await this.getKeywords(message.guild!.id);
    const matchedKeywords: { keyword: string; weight: number }[] = [];
    let totalKeywordScore = 0;

    for (const kw of keywords) {
      if (content.includes(kw.keyword.toLowerCase())) {
        matchedKeywords.push({ keyword: kw.keyword, weight: kw.weight });
        totalKeywordScore += kw.weight * 2;
      }
    }

    if (matchedKeywords.length > 0) {
      flags.suspiciousContent = true;
      score += Math.min(25, totalKeywordScore);
      const kwList = matchedKeywords.map(k => `${k.keyword} (w:${k.weight})`).join(', ');
      reasons.push(`Suspicious keywords: ${kwList}`);
    }

    // Check join velocity (burst detection)
    if (this.joinVelocityTracker && message.guild) {
      const windowMs = (config.joinVelocityWindowMinutes ?? 5) * 60 * 1000;
      const threshold = config.joinVelocityThreshold ?? 10;
      if (this.joinVelocityTracker.isBurstActive(message.guild.id, threshold, windowMs)) {
        flags.joinBurst = true;
        score += 15;
        const joinCount = this.joinVelocityTracker.getJoinCount(message.guild.id, windowMs);
        reasons.push(`Join burst detected (${joinCount} joins in ${config.joinVelocityWindowMinutes ?? 5} min)`);
      }
    }

    // Cap score at 100
    score = Math.min(100, score);

    return { score, flags, reasons };
  }

  private checkWhitelist(member: GuildMember, config: BaitChannelConfig): { whitelisted: boolean; reason: string } {
    // Server owner cannot be kicked/banned - always whitelist
    if (member.id === member.guild.ownerId) {
      return { whitelisted: true, reason: 'User is the Server Owner' };
    }

    // Check whitelisted users
    if (config.whitelistedUsers?.includes(member.id)) {
      return { whitelisted: true, reason: 'User is in manual whitelist' };
    }

    // Check whitelisted roles
    const whitelistedRole = member.roles.cache.find(role => config.whitelistedRoles?.includes(role.id));
    if (whitelistedRole) {
      return {
        whitelisted: true,
        reason: `User has whitelisted role: @${whitelistedRole.name}`,
      };
    }

    // Admins are whitelisted unless disableAdminWhitelist is enabled (for testing)
    if (!config.disableAdminWhitelist && member.permissions.has(PermissionFlagsBits.Administrator)) {
      return { whitelisted: true, reason: 'User is an Administrator' };
    }

    return { whitelisted: false, reason: '' };
  }

  private determineAction(score: number, config: BaitChannelConfig): string {
    if (!config.enableEscalation) {
      return config.actionType;
    }

    const timeoutThreshold = config.escalationTimeoutThreshold ?? 50;
    const kickThreshold = config.escalationKickThreshold ?? 75;
    const banThreshold = config.escalationBanThreshold ?? 90;

    if (score >= banThreshold) return 'ban';
    if (score >= kickThreshold) return 'kick';
    if (score >= timeoutThreshold) return 'timeout';
    return 'log-only';
  }

  /**
   * Executor action for a resolved action. 'kick' becomes 'softban' when we
   * have BAN_MEMBERS so messages get deleted via the ban API (softban = ban +
   * immediate unban); without it we fall back to a true kick + purge sweep.
   */
  private toApiAction(resolvedAction: string, guild: Guild): BanExecutorAction {
    if (resolvedAction === 'kick') {
      return guild.members.me?.permissions.has(PermissionFlagsBits.BanMembers) ? 'softban' : 'kick';
    }
    return resolvedAction as BanExecutorAction;
  }

  private async sendDmNotification(
    member: GuildMember,
    action: string,
    config: BaitChannelConfig,
    _analysis: SuspicionAnalysis,
  ): Promise<DmResult> {
    if (!config.dmBeforeAction) return { sent: false };
    if (action === 'log-only') return { sent: false };

    const actionLabels: Record<string, string> = {
      ban: 'Ban',
      kick: 'Kick',
      timeout: `Timeout (${config.timeoutDurationMinutes ?? 60} minutes)`,
    };

    try {
      const embed = new EmbedBuilder()
        .setColor(Colors.status.warning)
        .setTitle(`Action Taken in ${member.guild.name}`)
        .setDescription('Your message in a monitored channel triggered automatic detection.')
        .addFields(
          {
            name: 'Action',
            value: actionLabels[action] || action,
            inline: true,
          },
          { name: 'Server', value: member.guild.name, inline: true },
        );

      if (config.appealInfo) {
        embed.addFields({
          name: 'Appeal Information',
          value: config.appealInfo,
        });
      }

      // v3.2.0 — signed appeal link (issued when enableAppealLink + baseUrl
      // are configured + APPEAL_HMAC_SECRET env is set). Webapp consumer
      // (v3.2.1) verifies the token and auto-opens a banAppeal ticket. The
      // helper returns null silently for any missing prerequisite — falls
      // back to the static appealInfo above.
      const appealUrl = buildAppealUrl({
        guildId: member.guild.id,
        userId: member.id,
        action: action as 'ban' | 'softban' | 'kick' | 'timeout',
        banReason: config.banReason,
        baseUrl: config.enableAppealLink ? config.appealLinkBaseUrl : null,
      });
      if (appealUrl) {
        embed.addFields({
          name: 'Appeal this action',
          value: `[Open appeal form](${appealUrl})\n*Link is single-use and expires in 7 days.*`,
        });
      }

      // Race the DM against a 5s timeout — Discord can stall this call
      // indefinitely when the user's privacy settings have blocked us, and
      // we don't want the action path to wait forever. The send promise is
      // held in a local so its eventual rejection (after the timeout wins)
      // doesn't become an unhandled rejection — we attach a swallow-catch
      // for any post-race outcome we no longer care about.
      const sendPromise = member.send({ embeds: [embed] });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('dm_timeout')), 5_000);
      });
      try {
        await Promise.race([sendPromise, timeoutPromise]);
        if (timer) clearTimeout(timer);
        return { sent: true };
      } catch (raceError) {
        // If the timeout won, the underlying send may still settle later —
        // attach a swallow handler so Node doesn't log an unhandled rejection.
        sendPromise.catch(() => {});
        if (timer) clearTimeout(timer);
        throw raceError;
      }
    } catch (error) {
      const failureReason = classifyDmFailure(error);
      enhancedLogger.debug(
        `Failed to send DM notification to ${member.user.tag}: ${failureReason}`,
        LogCategory.SECURITY,
        { userId: member.id, guildId: member.guild.id, failureReason },
      );
      return { sent: false, failureReason };
    }
  }

  private async initiateGracePeriod(
    message: Message,
    config: BaitChannelConfig,
    analysis: SuspicionAnalysis,
  ): Promise<void> {
    const member = message.member!;
    // Read once, now: `message.guild` is a cache getter that turns null when
    // the bot leaves the guild, and the timer below must not depend on it.
    const guild = message.guild!;
    const guildId = guild.id;
    const key = graceKey(guildId, member.id, message.id);

    // Determine the potential action based on current score
    const potentialAction = this.determineAction(analysis.score, config);
    const actionDescription =
      potentialAction === 'timeout'
        ? `timed out for ${config.timeoutDurationMinutes ?? 60} minutes`
        : potentialAction === 'ban'
          ? 'banned'
          : potentialAction === 'kick'
            ? 'kicked'
            : 'logged';

    // Build warning message with suspicion details
    const isTestMode = config.testMode === true;
    const warningTitle = isTestMode ? '[TEST MODE] URGENT WARNING' : 'URGENT WARNING';
    const warningDescription = isTestMode
      ? `${config.warningMessage}\n\n**Test Mode Active** — No real action will be taken.`
      : config.warningMessage;
    const warningEmbed = new EmbedBuilder()
      .setColor(isTestMode ? Colors.status.info : Colors.status.error)
      .setTitle(warningTitle)
      .setDescription(warningDescription)
      .addFields(
        {
          name: '⏰ Action Required',
          value: `Delete your message within **${config.gracePeriodSeconds} seconds** to avoid being ${actionDescription}.`,
        },
        {
          name: '🚨 Suspicion Score',
          value: `${analysis.score}/100`,
          inline: true,
        },
        {
          name: '⏱️ Time Remaining',
          value: `${config.gracePeriodSeconds} seconds`,
          inline: true,
        },
      )

      .setFooter({ text: message.guild!.name });

    if (analysis.reasons.length > 0) {
      warningEmbed.addFields({
        name: '🔍 Detection Reasons',
        value: formatDetectionReasons(analysis.reasons),
      });
    }

    // Reply to the user's message in the channel.
    // If the user already deleted their message before our reply lands,
    // Discord rejects the reply with `MESSAGE_REFERENCE_UNKNOWN_MESSAGE`.
    // That's the user complying — log at debug, not as an error.
    let warningMessage: Message | null = null;
    try {
      warningMessage = await message.reply({ embeds: [warningEmbed] });
    } catch (error) {
      if (
        error instanceof DiscordAPIError &&
        typeof error.rawError === 'object' &&
        error.rawError !== null &&
        // 50035 = Invalid Form Body; nested message_reference error indicates the original message is gone
        JSON.stringify(error.rawError).includes('MESSAGE_REFERENCE_UNKNOWN_MESSAGE')
      ) {
        enhancedLogger.debug(
          `Skipped warning reply for ${member.user.tag} — user deleted their message before reply landed`,
          LogCategory.SECURITY,
          { userId: member.id, guildId: message.guild!.id },
        );
      } else {
        logError({
          category: ErrorCategory.DISCORD_API,
          severity: ErrorSeverity.MEDIUM,
          message: 'Failed to send warning reply to user',
          error,
          context: { userId: member.id, guildId: message.guild!.id },
        });
      }
    }

    // Set up action timer. Nothing in this callback may throw: an exception
    // escaping a timer is uncaught and shuts the whole bot down.
    const timeoutId = setTimeout(() => {
      this.inMemberChain(guildId, member.id, () => this.resolveGrace(key, 'Grace period expired')).catch(error =>
        logError({
          category: ErrorCategory.UNKNOWN,
          severity: ErrorSeverity.HIGH,
          message: 'Bait grace timer failed',
          error,
          context: { guildId, userId: member.id, messageId: message.id },
        }),
      );
    }, config.gracePeriodSeconds * 1000);

    const pendingBanData: PendingBan = {
      guildId,
      userId: member.id,
      messageId: message.id,
      channelId: message.channelId,
      timestamp: Date.now(),
      timeoutId,
      suspicionScore: analysis.score,
      warningMessageId: warningMessage?.id,
      context: { message, member, analysis, warningMessage, postedInTestMode: isTestMode },
    };
    this.pendingBans.set(key, pendingBanData);

    // Persist to DB for crash recovery, with the action it stands for.
    // Test mode persists 'log-only' so nothing that reads the row can act for real.
    const rowAction = isTestMode ? 'log-only' : this.toApiAction(potentialAction, guild);
    await this.savePendingBanToDb(guildId, pendingBanData, config.gracePeriodSeconds, rowAction);
  }

  /**
   * Settle a live grace entry, when its timer fires or right away when the
   * member leaves. Acts on CURRENT state, not the snapshot from when the
   * message was posted: config is re-read (disabled, channel removed, test
   * mode, thresholds), the whitelist is re-checked, and a deleted message
   * counts as compliance. The entry is claimed only after those awaits, so a
   * cancel or delete that lands meanwhile wins. Callers run it in the
   * member's chain (inMemberChain).
   *
   * `leave` is set when the member already left. If they left banned (a mod
   * or another bot), the entry ends without action: their ban stands, and
   * the purge that usually comes with it must not read as compliance.
   */
  private async resolveGrace(key: string, reason: string, leave?: LeaveState): Promise<void> {
    const pending = this.pendingBans.get(key);
    if (!pending?.context) return; // already settled (deleted, cancelled, left)
    const { message, member, analysis, postedInTestMode } = pending.context;

    // The bot is no longer in the guild (removed, or the guild was deleted):
    // nothing here can act, and guildDelete wipes the guild's data, the grace
    // row included. Drop the entry without writing anything.
    if (!message.guild) {
      clearTimeout(pending.timeoutId);
      this.pendingBans.delete(key);
      return;
    }

    let messageGone = false;
    try {
      await message.fetch();
    } catch {
      messageGone = true;
    }
    const config = await this.getConfig(pending.guildId);

    if (this.pendingBans.get(key) !== pending) return;
    clearTimeout(pending.timeoutId);
    this.pendingBans.delete(key);

    try {
      await this.removePendingBanFromDb(pending.userId, pending.messageId, pending.guildId);

      if (leave?.banned) {
        if (!messageGone) {
          // The ban kept their messages: still clear the bait post.
          await message.delete().catch(error =>
            logError({
              category: ErrorCategory.DISCORD_API,
              severity: ErrorSeverity.LOW,
              message: 'Failed to delete bait channel message from banned user',
              error,
              context: { messageId: message.id, guildId: pending.guildId },
            }),
          );
        }
        if (config) await this.logAction(message, member, 'superseded-by-mod', config, analysis);
        enhancedLogger.info(
          `Bait grace for ${member.user.tag} ended without action (banned when they left)`,
          LogCategory.SECURITY,
          { guildId: pending.guildId, userId: pending.userId },
        );
        return;
      }

      if (messageGone) {
        // User complied in time
        if (config) await this.logAction(message, member, 'deleted-in-time', config, analysis);
        return;
      }

      // Disabled, unreadable, or this channel is no longer a bait channel: stand down.
      if (!config?.enabled || !getBaitChannelIds(config).includes(message.channelId)) {
        enhancedLogger.info(
          `Bait grace for ${member.user.tag} ended without action (bait channel disabled or removed)`,
          LogCategory.SECURITY,
          { guildId: pending.guildId, userId: pending.userId },
        );
        return;
      }

      const whitelist = this.checkWhitelist(member, config);
      if (whitelist.whitelisted) {
        await message.delete().catch(error =>
          logError({
            category: ErrorCategory.DISCORD_API,
            severity: ErrorSeverity.LOW,
            message: 'Failed to delete bait channel message from whitelisted user',
            error,
            context: { messageId: message.id, guildId: pending.guildId },
          }),
        );
        await this.logToChannelWhitelisted(member, message, config, whitelist.reason);
        await this.logAction(message, member, 'whitelisted', config);
        return;
      }

      const effective = postedInTestMode && !config.testMode ? { ...config, testMode: true } : config;
      await this.executeAction(member, message, effective, analysis, reason, leave);
    } catch (error) {
      logError({
        category: ErrorCategory.UNKNOWN,
        severity: ErrorSeverity.HIGH,
        message: 'Failed to resolve bait grace period',
        error,
        context: { guildId: pending.guildId, userId: pending.userId, messageId: pending.messageId },
      });
    } finally {
      await this.deleteGraceWarning(pending);
    }
  }

  async handleMessageDelete(messageId: string, guildId: string): Promise<void> {
    try {
      for (const [key, pendingBan] of this.pendingBans.entries()) {
        if (pendingBan.guildId === guildId && pendingBan.messageId === messageId) {
          clearTimeout(pendingBan.timeoutId);
          this.pendingBans.delete(key);
          await this.removePendingBanFromDb(pendingBan.userId, messageId, guildId);
          await this.deleteGraceWarning(pendingBan);
          break;
        }
      }
    } catch (error) {
      logError({
        category: ErrorCategory.UNKNOWN,
        severity: ErrorSeverity.MEDIUM,
        message: 'Failed to handle message deletion in bait channel',
        error,
        context: { messageId, guildId },
      });
    }
  }

  /**
   * Scan the guild's text channels and delete recent messages from a user.
   * Processes channels sequentially to avoid rate limits. With `postedSince`
   * (the member's join time), channels whose last message is older are
   * skipped without a fetch: the user can't have posted there since. In a
   * raid that keeps each sweep to the channels that saw activity, not one
   * 100-message fetch per channel per action on the bot-wide REST budget.
   */
  private async purgeUserMessages(guild: Guild, userId: string, postedSince?: number | null): Promise<PurgeResult> {
    let totalDeleted = 0;
    let channelCount = 0;

    try {
      const channels = guild.channels.cache.filter(
        ch =>
          (ch.type === ChannelType.GuildText ||
            ch.type === ChannelType.GuildAnnouncement ||
            ch.type === ChannelType.GuildVoice) &&
          !(postedSince && quietSince(ch, postedSince)),
      );

      for (const [, channel] of channels) {
        try {
          const textChannel = channel as TextChannel;

          // Check bot has required permissions
          const botMember = guild.members.me;
          if (!botMember) continue;

          const perms = textChannel.permissionsFor(botMember);
          if (
            !perms?.has(PermissionFlagsBits.ViewChannel) ||
            !perms?.has(PermissionFlagsBits.ManageMessages) ||
            !perms?.has(PermissionFlagsBits.ReadMessageHistory)
          ) {
            continue;
          }

          // Fetch last 100 messages and filter by the banned user
          let messages: Collection<string, Message>;
          try {
            messages = await textChannel.messages.fetch({ limit: 100 });
          } catch {
            continue; // Can't fetch messages in this channel, skip
          }

          const userMessages = messages.filter(m => m.author.id === userId);
          if (userMessages.size === 0) continue;

          // Separate messages into bulk-deletable (< 14 days old) and old
          const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
          const bulkDeletable = userMessages.filter(m => m.createdTimestamp > fourteenDaysAgo);
          const tooOld = userMessages.filter(m => m.createdTimestamp <= fourteenDaysAgo);

          // Bulk delete recent messages (up to 100 at once)
          if (bulkDeletable.size > 0) {
            try {
              const deleted = await textChannel.bulkDelete(bulkDeletable, true);
              totalDeleted += deleted.size;
            } catch {
              // Fallback to individual delete if bulk fails
              for (const [, msg] of bulkDeletable) {
                try {
                  await msg.delete();
                  totalDeleted++;
                } catch {
                  // Skip messages we can't delete
                }
              }
            }
          }

          // Delete old messages individually
          for (const [, msg] of tooOld) {
            try {
              await msg.delete();
              totalDeleted++;
            } catch {
              // Skip messages we can't delete
            }
          }

          if (userMessages.size > 0) {
            channelCount++;
          }
        } catch (error) {
          enhancedLogger.debug(`Purge: failed to process channel ${channel.id}`, LogCategory.SECURITY, {
            channelId: channel.id,
            userId,
            error: (error as Error).message,
          });
        }
      }

      if (totalDeleted > 0) {
        enhancedLogger.info(
          `Purged ${totalDeleted} messages across ${channelCount} channels for user ${userId}`,
          LogCategory.SECURITY,
          {
            userId,
            guildId: guild.id,
            totalDeleted,
            channelCount,
          },
        );
      }
    } catch (error) {
      logError({
        category: ErrorCategory.DISCORD_API,
        severity: ErrorSeverity.MEDIUM,
        message: 'Failed to purge user messages across channels',
        error,
        context: { userId, guildId: guild.id },
      });

      return {
        totalDeleted,
        channelCount,
        error: 'Purge failed - see logs for details',
      };
    }

    return { totalDeleted, channelCount };
  }

  private async executeAction(
    member: GuildMember,
    message: Message,
    config: BaitChannelConfig,
    analysis: SuspicionAnalysis,
    reason: string,
    leave?: LeaveState,
  ): Promise<void> {
    // Test mode: still delete message but skip ban/kick/timeout and purge
    const isTestMode = config.testMode === true;

    // Determine action (escalation-aware)
    const resolvedAction = this.determineAction(analysis.score, config);
    let apiAction = this.toApiAction(resolvedAction, message.guild!);
    // What the DM, embed and log report.
    let shownAction = resolvedAction;

    // A member who already left can't be timed out or kicked. The REST ban
    // endpoint works by user ID, so those become a softban (ban + unban, which
    // also purges their messages), reported as one. That needs to know they
    // aren't banned: a softban lifts any ban in place. When the ban list says
    // otherwise or can't be read (no BAN_MEMBERS, in which case the softban
    // would fail anyway), nothing is done and the post is only logged.
    let demotedOnLeave = false;
    if (leave && (apiAction === 'timeout' || apiAction === 'kick' || apiAction === 'softban')) {
      demotedOnLeave = leave.banned !== false;
      apiAction = demotedOnLeave ? 'log-only' : 'softban';
      shownAction = apiAction;
    }

    let actionTaken: string = shownAction;
    let actionResult: 'success' | 'failed' = 'success';
    let failureReason: string | undefined;

    // Step 1: Delete the user's message first
    try {
      await message.delete();
    } catch (error) {
      logError({
        category: ErrorCategory.DISCORD_API,
        severity: ErrorSeverity.MEDIUM,
        message: 'Failed to delete bait channel message',
        error,
        context: { messageId: message.id, guildId: message.guild!.id },
      });
    }

    let purgeResult: PurgeResult | undefined;

    // Step 2: Send DM notification BEFORE action (user must still be in server).
    // The DM result is structured — we record whether it landed and (if not)
    // why, so admins reviewing the bait log can distinguish DM-blocked from
    // DM-attempted-and-failed cases. A softban on leave sends none: the member
    // is gone, and the timeout or kick their warning named never happens.
    let dmResult: DmResult = { sent: false };
    if (!isTestMode && shownAction !== 'softban') {
      dmResult = await this.sendDmNotification(member, shownAction, config, analysis);
    }
    const dmSent = dmResult.sent;

    // Step 3: Execute the resolved action via REST executor (idempotent, leave-tolerant).
    // 'kick' is mapped to 'softban' when we have BAN_MEMBERS so messages get
    // deleted via the ban API (softban = ban + immediate unban). Without
    // BAN_MEMBERS we fall back to a true kick + bot-side purge sweep (toApiAction).
    const deleteHours = config.deleteMessageHours ?? 24;
    const timeoutMs = (config.timeoutDurationMinutes ?? 60) * 60 * 1000;
    const channelName =
      'name' in message.channel && typeof message.channel.name === 'string' ? message.channel.name : message.channelId;
    const auditReason = buildAuditReason({
      score: analysis.score,
      channelName,
      flags: flagsTriggered(analysis.flags),
      messageId: message.id,
      extra: reason,
    });

    const executorResult: BanExecutorResult | null = this.idempotencyRepo
      ? await executeBanAction(
          {
            guild: message.guild!,
            userId: member.id,
            action: apiAction,
            reason: auditReason,
            executorId: this.client.user?.id ?? null,
            deleteMessageSeconds: apiAction === 'ban' || apiAction === 'softban' ? deleteHours * 3600 : undefined,
            timeoutMs: apiAction === 'timeout' ? timeoutMs : undefined,
            member,
            testMode: isTestMode,
          },
          this.idempotencyRepo,
        )
      : null;

    // A removal landed (or someone already did it today): end the user's
    // other grace periods here without acting (see dropGraceForUser). If it
    // failed, they keep their own timers.
    const removesMember = apiAction === 'ban' || apiAction === 'softban' || apiAction === 'kick';
    if (
      !isTestMode &&
      removesMember &&
      (executorResult?.status === 'executed' || executorResult?.status === 'duplicate')
    ) {
      await this.dropGraceForUser(message.guild!.id, member.id);
    }

    // Translate executor result into the BaitChannelLog `actionTaken` value
    // the rest of this method expects. Preserve existing test-* / failed /
    // logged naming so the channel embed + DB row stay backward-compatible.
    if (executorResult === null) {
      // No idempotency repo wired — boot path / test fixture. Defer to
      // best-effort path so the manager still functions before Phase 2 is
      // fully wired. (Removed once index.ts boot passes the repo.)
      actionResult = 'failed';
      actionTaken = 'failed';
      failureReason = 'idempotency repo unavailable';
    } else if (executorResult.status === 'duplicate') {
      // Someone (mod, retry queue, prior call) already did this action today.
      actionTaken = 'superseded';
      enhancedLogger.info(
        `Bait action ${apiAction} for ${member.user.tag} skipped — idempotency dedup`,
        LogCategory.SECURITY,
        { userId: member.id, guildId: message.guild!.id, action: apiAction },
      );
    } else if (executorResult.status === 'queued') {
      // Hand off to the retry queue. The action is recorded as 'queued' in
      // the BaitChannelLog (admins can see it pending review); the retry
      // queue will flip the action to its real value on success or
      // dead-letter it after MAX_ATTEMPTS.
      actionResult = 'failed';
      actionTaken = 'queued';
      failureReason = executorResult.failureReason;

      // Never queue a test-mode dry run: the retry queue would run it for real.
      const queue = isTestMode ? null : getRetryQueue();
      if (queue) {
        await queue.enqueue({
          guildId: message.guild!.id,
          userId: member.id,
          messageId: message.id,
          channelId: message.channelId,
          action: apiAction as 'ban' | 'softban' | 'kick' | 'timeout' | 'log-only',
          suspicionScore: analysis.score,
          lastError: executorResult.failureReason,
        });
      }

      enhancedLogger.warn(
        `Bait action ${apiAction} for ${member.user.tag} queued for retry: ${executorResult.failureReason ?? 'unknown'}`,
        LogCategory.SECURITY,
        { userId: member.id, guildId: message.guild!.id, action: apiAction },
      );
    } else if (executorResult.status === 'failed') {
      actionResult = 'failed';
      actionTaken = 'failed';
      failureReason = executorResult.failureReason;
      logError({
        category: ErrorCategory.DISCORD_API,
        severity: ErrorSeverity.HIGH,
        message: `Bait action ${apiAction} failed terminally`,
        error: new Error(executorResult.failureReason ?? 'unknown'),
        context: {
          userId: member.id,
          guildId: message.guild!.id,
          action: apiAction,
          errorCode: executorResult.errorCode,
        },
      });
    } else {
      // executed — including test mode dry-run (the executor itself logs the [TEST MODE] line).
      if (isTestMode) {
        actionTaken = `test-${shownAction}`;
      } else if (demotedOnLeave) {
        actionTaken = 'demoted-after-leave';
      } else if (resolvedAction === 'log-only') {
        actionTaken = 'logged';
      } else {
        actionTaken = shownAction;
      }

      enhancedLogger.info(
        isTestMode
          ? `[TEST MODE] Bait dry-run ${apiAction} for ${member.user.tag} (Score: ${analysis.score})`
          : `Bait ${apiAction} executed for ${member.user.tag} (Score: ${analysis.score})`,
        LogCategory.SECURITY,
        {
          userId: member.id,
          score: analysis.score,
          action: actionTaken,
          deleteMessageHours: apiAction === 'ban' || apiAction === 'softban' ? deleteHours : undefined,
          timeoutMinutes: apiAction === 'timeout' ? (config.timeoutDurationMinutes ?? 60) : undefined,
          guildId: message.guild!.id,
        },
      );

      // Raid mode signal: real (non-test, non-log-only) action just landed.
      // Records into the per-guild sliding window; entering raid mode is
      // handled inside `recordTrigger` and produces its own logs/alerts.
      // Recorded before the purge below, which can take many seconds and
      // would hold the trigger outside the raid window.
      if (!isTestMode && apiAction !== 'log-only' && message.guild) {
        const raidMgr = getRaidModeManager();
        if (raidMgr) {
          await raidMgr.recordTrigger(message.guild, member.id, config);
        }
      }

      // Timeout + kick-fallback need a bot-side message purge — Discord's
      // ban API isn't involved so we do it ourselves. Skipped in test mode.
      if (!isTestMode && (apiAction === 'timeout' || apiAction === 'kick') && message.guild) {
        purgeResult = await this.purgeUserMessages(message.guild, member.id, member.joinedTimestamp);
      }
    }

    // Step 4: Additional cross-channel purge (beyond Discord's ban deletion) — skip in test mode
    // Ban/kick already delete messages via Discord API (deleteMessageSeconds).
    // This additional sweep catches anything Discord missed. Timeout purge runs inside the switch above.
    // Skipped when the kick fallback already swept, and when our ban's own
    // deletion window reaches back past the member's join (Discord already
    // removed everything they posted since; messages from an earlier stay in
    // the server are the one thing that misses).
    const banPurgeCoversMembership =
      executorResult?.status === 'executed' &&
      (apiAction === 'ban' || apiAction === 'softban') &&
      member.joinedTimestamp != null &&
      Date.now() - member.joinedTimestamp <= deleteHours * 3_600_000;
    if (
      !isTestMode &&
      actionResult === 'success' &&
      config.deleteUserMessages &&
      (shownAction === 'ban' || shownAction === 'kick' || shownAction === 'softban') &&
      !purgeResult &&
      !banPurgeCoversMembership &&
      message.guild
    ) {
      purgeResult = await this.purgeUserMessages(message.guild, member.id, member.joinedTimestamp);
    }

    // Step 4b: Detect repeat offenders (for ban/kick actions only)
    let repeatOffenderResult: RepeatOffenderResult | null = null;
    if (actionResult === 'success' && config.actionType !== 'log-only' && member.joinedAt) {
      repeatOffenderResult = await this.detectRepeatOffenders(member, message.guild!.id);
    }

    // Step 5: Log to channel AFTER purge. The result determines whether the
    // BaitChannelLog row gets `logDeliveryFailed=true` so admins can audit
    // silent log-delivery failures from the dashboard.
    const logDelivered = await this.logToChannel(
      member,
      message,
      config,
      analysis,
      reason,
      shownAction,
      actionResult,
      failureReason,
      purgeResult,
      dmSent,
      repeatOffenderResult,
    );

    // Step 6: Log to database with full v3.2.0 observability columns.
    await this.logAction(message, member, actionTaken, config, analysis, failureReason, {
      dmResult,
      logDeliveryFailed: !logDelivered,
      executorId: executorResult?.status === 'executed' ? (this.client.user?.id ?? null) : null,
    });
  }

  /**
   * Detect accounts that joined around the same time with similar suspicious characteristics.
   * Returns null if fewer than 3 matching accounts are found (not enough evidence).
   */
  private async detectRepeatOffenders(member: GuildMember, guildId: string): Promise<RepeatOffenderResult | null> {
    try {
      if (!member.joinedAt) return null;

      const joinEventRepo = AppDataSource.getRepository(JoinEvent);
      const windowMs = 30 * 60 * 1000; // +/- 30 minutes
      const windowStart = new Date(member.joinedAt.getTime() - windowMs);
      const windowEnd = new Date(member.joinedAt.getTime() + windowMs);

      const nearbyJoins = await joinEventRepo.find({
        where: {
          guildId,
          joinedAt: Between(windowStart, windowEnd),
        },
      });

      // Filter for accounts with suspicious characteristics
      const accountAgeWindow = 48 * 60 * 60 * 1000; // 48 hours
      const matchingUsers = nearbyJoins.filter(je => {
        if (je.userId === member.id) return false; // Exclude self
        if (!je.hasDefaultAvatar) return false;
        if (je.roleCount > 1) return false;
        // Account created within 48h of the triggering user's account
        const ageDiff = Math.abs(je.accountCreatedAt.getTime() - member.user.createdAt.getTime());
        return ageDiff <= accountAgeWindow;
      });

      if (matchingUsers.length < 3) return null;

      return {
        matchCount: matchingUsers.length,
        matchingUsers: matchingUsers.map(je => ({
          userId: je.userId,
          joinedAt: je.joinedAt,
          accountCreatedAt: je.accountCreatedAt,
        })),
      };
    } catch (error) {
      enhancedLogger.debug(`Failed to detect repeat offenders for ${member.user.tag}`, LogCategory.DATABASE, {
        error: (error as Error).message,
      });
      return null;
    }
  }

  private async logAction(
    message: Message,
    member: GuildMember,
    action: string,
    _config: BaitChannelConfig,
    analysis?: SuspicionAnalysis,
    failureReason?: string,
    extras?: {
      dmResult?: DmResult;
      logDeliveryFailed?: boolean;
      executorId?: string | null;
    },
  ): Promise<void> {
    // We accept `member` from the caller rather than re-deriving it from
    // `message.member`. Discord.js drops `message.member` to null once the
    // user has been banned/kicked or once the partial is evicted from cache,
    // so by the time we reach this function (post-ban or post-delete) the
    // lookup would null-deref. The caller always has a fresh reference in
    // scope from when the bait message was first seen — pass it through.
    try {
      const userActivity = await this.activityRepo.findOne({
        where: { guildId: message.guild!.id, userId: member.id },
      });

      const accountAgeDays = (Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24);
      const joinedTs = member.joinedTimestamp ?? Date.now();
      const membershipMinutes = (Date.now() - joinedTs) / (1000 * 60);

      const logEntry: Partial<BaitChannelLog> = {
        guildId: message.guild!.id,
        userId: member.id,
        username: member.user.tag,
        channelId: message.channelId,
        messageContent: message.content,
        messageId: message.id,
        actionTaken: action,
        failureReason: failureReason || undefined,
        accountAgeDays,
        membershipMinutes,
        messageCount: userActivity?.messageCount || 0,
        hasVerifiedRole: member.roles.cache.some(
          r => r.name.toLowerCase().includes('verified') || r.name.toLowerCase().includes('member'),
        ),
        suspicionScore: analysis?.score || 0,
        detectionFlags: analysis?.flags || undefined,
        // v3.2.0 audit/observability columns. dmSent + dmFailureReason
        // populated from the caller's DmResult; executorId tags self vs mod
        // (Phase 4 fills it for the superseded-by-mod case);
        // logDeliveryFailed mirrors whether the channel embed landed.
        dmSent: extras?.dmResult?.sent ?? false,
        dmFailureReason: extras?.dmResult?.failureReason ?? null,
        executorId: extras?.executorId ?? null,
        logDeliveryFailed: extras?.logDeliveryFailed ?? false,
      };

      await this.logRepo.save(this.logRepo.create(logEntry));
    } catch (error) {
      logError({
        category: ErrorCategory.DATABASE,
        severity: ErrorSeverity.MEDIUM,
        message: 'Failed to log bait channel action to database',
        error,
        context: {
          guildId: message.guild!.id,
          userId: member.id,
          action,
        },
      });
    }
  }

  private async logToChannel(
    member: GuildMember,
    message: Message,
    config: BaitChannelConfig,
    analysis: SuspicionAnalysis,
    reason: string,
    resolvedAction: string,
    actionResult: 'success' | 'failed' = 'success',
    failureReason?: string,
    purgeResult?: PurgeResult,
    dmSent?: boolean,
    repeatOffenderResult?: RepeatOffenderResult | null,
  ): Promise<boolean> {
    if (!config.logChannelId) return true; // not configured — not a failure

    try {
      const logChannel = (await message
        .guild!.channels.fetch(config.logChannelId)
        .catch(() => null)) as TextChannel | null;
      if (!logChannel) {
        // Configured but inaccessible — try the owner-DM fallback.
        return await this.fallbackLogDmOwner(message.guild!, resolvedAction, member.id, 'log channel not accessible');
      }

      // Check if this is a test mode action
      const isTestMode = config.testMode === true;

      // Different display for success vs failure vs test mode
      let actionEmoji: string;
      let actionText: string;
      let color: ColorResolvable;

      if (isTestMode) {
        const textMap: Record<string, string> = {
          ban: 'Would Ban',
          kick: 'Would Kick',
          softban: 'Would Softban',
          timeout: `Would Timeout (${config.timeoutDurationMinutes ?? 60} min)`,
          'log-only': 'Logged (No action)',
        };
        actionEmoji = '';
        actionText = textMap[resolvedAction] || 'Detection logged';
        color = Colors.status.info; // Informational color for test mode
      } else if (actionResult === 'failed') {
        actionEmoji = '';
        const failedMap: Record<string, string> = {
          ban: 'Ban',
          kick: 'Kick',
          softban: 'Softban',
          timeout: 'Timeout',
        };
        actionText = `${failedMap[resolvedAction] ?? 'Action'} FAILED`;
        color = Colors.status.neutral; // Gray for failure
      } else {
        const emojiMap: Record<string, string> = {
          ban: '',
          kick: '',
          timeout: '',
          'log-only': '',
        };
        actionEmoji = emojiMap[resolvedAction] || '';

        const textMap: Record<string, string> = {
          ban: 'Banned',
          kick: 'Kicked',
          softban: 'Softbanned',
          timeout: `Timed Out (${config.timeoutDurationMinutes ?? 60} min)`,
          'log-only': 'Logged (No action)',
        };
        actionText = textMap[resolvedAction] || 'Action taken';

        color =
          analysis.score >= 90
            ? Colors.severity.critical
            : analysis.score >= 70
              ? Colors.severity.high
              : analysis.score >= 50
                ? Colors.severity.medium
                : Colors.status.warning;
      }

      const testPrefix = isTestMode ? '[TEST MODE] ' : '';
      const description =
        actionResult === 'failed'
          ? `**${member.user.tag}** triggered the bait channel but the action failed`
          : isTestMode
            ? `**${member.user.tag}** triggered the bait channel (test mode — no real action taken)`
            : `**${member.user.tag}** triggered the bait channel`;

      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`${testPrefix}${actionEmoji} Bait Channel ${actionText}`)
        .setDescription(description)
        .addFields(
          {
            name: '👤 User',
            value: `${member.user.tag}\n\`${member.id}\``,
            inline: true,
          },
          {
            name: '🎭 Roles',
            value: member.roles.cache.size > 1 ? `${member.roles.cache.size - 1} roles` : 'No roles',
            inline: true,
          },
          { name: '⚡ Reason', value: reason, inline: false },
          {
            name: '📅 Account Created',
            value: `<t:${toUnixSeconds(new Date(member.user.createdTimestamp))}:R>`,
            inline: true,
          },
          {
            name: '📥 Joined Server',
            value: `<t:${toUnixSeconds(new Date(member.joinedTimestamp!))}:R>`,
            inline: true,
          },
          {
            name: '📊 Suspicion Score',
            value: `**${analysis.score}/100**`,
            inline: true,
          },
        )
        .setThumbnail(member.user.displayAvatarURL());

      if (analysis.reasons.length > 0) {
        embed.addFields({
          name: '🔍 Detection Flags',
          value: formatDetectionReasons(analysis.reasons),
        });
      }

      // Add failure reason if action failed
      if (actionResult === 'failed' && failureReason) {
        embed.addFields({
          name: '⚠️ Failure Reason',
          value: truncateWithNotice(failureReason, 1024),
        });
      }

      if (message.content) {
        embed.addFields({
          name: '💬 Message Content',
          value: truncateWithNotice(message.content, 1024),
        });
      }

      if (message.attachments.size > 0) {
        embed.addFields({
          name: '📎 Attachments',
          value: `${message.attachments.size} attachment(s)`,
        });
      }

      // Add purge summary if a purge was attempted
      if (purgeResult) {
        let purgeValue: string;
        if (purgeResult.error) {
          purgeValue = purgeResult.error;
        } else if (purgeResult.totalDeleted > 0) {
          purgeValue = `Removed ${purgeResult.totalDeleted} message(s) across ${purgeResult.channelCount} channel(s)`;
        } else {
          purgeValue = 'No additional messages found';
        }
        embed.addFields({
          name: '🧹 Message Purge',
          value: purgeValue,
        });
      }

      // Add escalation mode info
      if (config.enableEscalation) {
        embed.addFields({
          name: '📈 Escalation Mode',
          value: `Score-based action (log: ${config.escalationLogThreshold ?? 30}+ / timeout: ${config.escalationTimeoutThreshold ?? 50}+ / kick: ${config.escalationKickThreshold ?? 75}+ / ban: ${config.escalationBanThreshold ?? 90}+)`,
        });
      }

      // Add DM notification status (none is sent for log-only or a softban on leave)
      if (config.dmBeforeAction && resolvedAction !== 'log-only' && resolvedAction !== 'softban') {
        embed.addFields({
          name: '📩 DM Notification',
          value: dmSent ? 'DM notification sent' : 'DM notification failed (user has DMs disabled)',
        });
      }

      // Add repeat offender annotation if detected
      if (repeatOffenderResult && repeatOffenderResult.matchCount > 0) {
        const matchList = repeatOffenderResult.matchingUsers
          .slice(0, 10) // Cap display at 10
          .map(u => `• <@${u.userId}> — joined <t:${toUnixSeconds(u.joinedAt)}:R>`)
          .join('\n');
        embed.addFields({
          name: '🚨 Possible Coordinated Raid',
          value: `${repeatOffenderResult.matchCount} similar account(s) joined around the same time:\n${matchList}`,
        });
      }

      await logChannel.send({ embeds: [embed] });
      return true;
    } catch (error) {
      logError({
        category: ErrorCategory.DISCORD_API,
        severity: ErrorSeverity.MEDIUM,
        message: 'Failed to send bait channel log to channel',
        error,
        context: {
          guildId: message.guild!.id,
          logChannelId: config.logChannelId,
        },
      });
      // Last-ditch: DM the guild owner so the action doesn't go silently
      // unrecorded. They can then re-create the log channel or pick a new one.
      return await this.fallbackLogDmOwner(
        message.guild!,
        resolvedAction,
        member.id,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Last-resort log delivery when the configured `logChannelId` is gone or
   * the bot can't send to it. Returns `true` if the owner DM landed,
   * `false` if it also failed. A `false` return signals `logDeliveryFailed`
   * on the BaitChannelLog row so admins can audit silent-failure cases.
   */
  private async fallbackLogDmOwner(guild: Guild, action: string, userId: string, reason: string): Promise<boolean> {
    try {
      const owner = await guild.fetchOwner().catch(() => null);
      if (!owner) return false;
      await owner.send({
        content:
          `⚠️ **Bait channel log delivery failed** in **${guild.name}**.\n` +
          `Action \`${action}\` was taken against <@${userId}> but the configured ` +
          `log channel is unreachable (\`${reason}\`).\n` +
          `Please update the bait log channel via \`/baitchannel setup\` or the dashboard.`,
      });
      return true;
    } catch (error) {
      enhancedLogger.warn(
        `Bait log owner-DM fallback also failed for guild ${guild.id}: ${error instanceof Error ? error.message : String(error)}`,
        LogCategory.SECURITY,
        { guildId: guild.id, userId, action },
      );
      return false;
    }
  }

  private async logToChannelWhitelisted(
    member: GuildMember,
    message: Message,
    config: BaitChannelConfig,
    whitelistReason: string,
  ): Promise<void> {
    if (!config.logChannelId) return;

    try {
      const logChannel = (await message
        .guild!.channels.fetch(config.logChannelId)
        .catch(() => null)) as TextChannel | null;
      if (!logChannel) return;

      const embed = new EmbedBuilder()
        .setColor(Colors.bait.whitelisted)
        .setTitle('Whitelisted User - Message Removed')
        .setDescription(
          `**${member.user.tag}** posted in the bait channel but is whitelisted.\nMessage was removed but **no action was taken**.`,
        )
        .addFields(
          {
            name: '👤 User',
            value: `${member.user.tag}\n\`${member.id}\``,
            inline: true,
          },
          {
            name: '🎭 Roles',
            value: member.roles.cache.size > 1 ? `${member.roles.cache.size - 1} roles` : 'No roles',
            inline: true,
          },
          {
            name: '🛡️ Whitelist Reason',
            value: whitelistReason,
            inline: false,
          },
          {
            name: '📅 Account Created',
            value: `<t:${toUnixSeconds(new Date(member.user.createdTimestamp))}:R>`,
            inline: true,
          },
          {
            name: '📥 Joined Server',
            value: `<t:${toUnixSeconds(new Date(member.joinedTimestamp!))}:R>`,
            inline: true,
          },
        )
        .setThumbnail(member.user.displayAvatarURL());

      if (message.content) {
        embed.addFields({
          name: '💬 Message Content',
          value: truncateWithNotice(message.content, 1024),
        });
      }

      if (message.attachments.size > 0) {
        embed.addFields({
          name: '📎 Attachments',
          value: `${message.attachments.size} attachment(s)`,
        });
      }

      await logChannel.send({ embeds: [embed] });
    } catch (error) {
      logError({
        category: ErrorCategory.DISCORD_API,
        severity: ErrorSeverity.MEDIUM,
        message: 'Failed to send whitelisted user log to channel',
        error,
        context: {
          guildId: message.guild!.id,
          logChannelId: config.logChannelId,
        },
      });
    }
  }

  private async getConfig(guildId: string): Promise<BaitChannelConfig | null> {
    try {
      // getOrLoad caches only a non-null config (TTL-evicted on read), so an
      // unconfigured guild is re-queried rather than cached — as before.
      return await this.configCache.getOrLoad(guildId, gid => this.configRepo.findOne({ where: { guildId: gid } }));
    } catch (error) {
      logError({
        category: ErrorCategory.DATABASE,
        severity: ErrorSeverity.HIGH,
        message: 'Failed to fetch bait channel config',
        error,
        context: { guildId },
      });
      return null;
    }
  }

  private async getKeywords(guildId: string): Promise<BaitKeyword[]> {
    if (!this.keywordRepo) return [];
    const repo = this.keywordRepo;

    try {
      return (await this.keywordCache.getOrLoad(guildId, gid => repo.find({ where: { guildId: gid } }))) ?? [];
    } catch (error) {
      logError({
        category: ErrorCategory.DATABASE,
        severity: ErrorSeverity.MEDIUM,
        message: 'Failed to fetch bait channel keywords',
        error,
        context: { guildId },
      });
      return [];
    }
  }

  public clearKeywordCache(guildId: string): void {
    this.keywordCache.invalidate(guildId);
  }

  public clearConfigCache(guildId: string): void {
    this.configCache.invalidate(guildId);
  }

  /**
   * Cached config lookup for event handlers outside the manager (e.g.
   * guildMemberAdd) — the raw repo query per member join was a raid
   * amplifier, hammering the DB exactly when joins spike.
   */
  public getCachedConfig(guildId: string): Promise<BaitChannelConfig | null> {
    return this.getConfig(guildId);
  }

  // Track user activity in-memory, flushed to DB periodically
  async trackMessage(message: Message): Promise<void> {
    if (!message.guild || message.author.bot) return;

    // Skip activity tracking if bait channel isn't configured/enabled for this guild
    const config = await this.getConfig(message.guild.id);
    if (!config?.enabled) return;

    const key = `${message.guild.id}:${message.author.id}`;
    const existing = this.activityBuffer.get(key);
    const now = new Date();

    if (existing) {
      existing.messageCount++;
      existing.lastMessageAt = now;
    } else {
      this.activityBuffer.set(key, {
        messageCount: 1,
        firstMessageAt: now,
        lastMessageAt: now,
        joinedAt: message.member?.joinedAt || now,
      });
    }
  }

  // Flush buffered activity counts to the database
  async flushActivityBuffer(): Promise<void> {
    if (this.activityBuffer.size === 0) return;

    // Swap out the buffer so new messages accumulate in a fresh map
    const toFlush = this.activityBuffer;
    this.activityBuffer = new Map();

    try {
      // Batch-load every buffered row in ONE query (this used to be a findOne
      // + save pair per user — 2N sequential queries per flush across all
      // bait-enabled guilds), then bulk-save the merged results.
      const wherePairs = [...toFlush.keys()].map(key => {
        const [guildId, userId] = key.split(':');
        return { guildId, userId };
      });
      const existing = await this.activityRepo.find({ where: wherePairs });
      const byKey = new Map(existing.map(a => [`${a.guildId}:${a.userId}`, a]));

      const toSave = [];
      for (const [key, buffered] of toFlush) {
        const [guildId, userId] = key.split(':');
        const activity = byKey.get(key);
        if (!activity) {
          toSave.push(
            this.activityRepo.create({
              guildId,
              userId,
              messageCount: buffered.messageCount,
              firstMessageAt: buffered.firstMessageAt,
              lastMessageAt: buffered.lastMessageAt,
              joinedAt: buffered.joinedAt,
            }),
          );
        } else {
          activity.messageCount += buffered.messageCount;
          activity.lastMessageAt = buffered.lastMessageAt;
          toSave.push(activity);
        }
      }
      await this.activityRepo.save(toSave);
    } catch (error) {
      // Activity stats are advisory — losing one flush is acceptable, matching
      // the old per-key LOW-severity swallow.
      logError({
        category: ErrorCategory.DATABASE,
        severity: ErrorSeverity.LOW,
        message: 'Failed to flush user activity buffer',
        error,
        context: { bufferedUsers: toFlush.size },
      });
    }
  }

  startActivityFlush(): void {
    if (this.activityFlushInterval) return;
    this.activityFlushInterval = setInterval(() => {
      this.flushActivityBuffer().catch(error => {
        logError({
          category: ErrorCategory.DATABASE,
          severity: ErrorSeverity.LOW,
          message: 'Activity buffer flush interval failed',
          error,
          context: {},
        });
      });
    }, INTERVALS.ACTIVITY_FLUSH);
  }

  stopActivityFlush(): void {
    if (this.activityFlushInterval) {
      clearInterval(this.activityFlushInterval);
      this.activityFlushInterval = null;
    }
  }

  /**
   * Returns a snapshot of tracked Map sizes for memory watchdog monitoring.
   */
  getTrackedMaps(): Record<string, number> {
    return {
      configCache: this.configCache.size,
      pendingBans: this.pendingBans.size,
      activityBuffer: this.activityBuffer.size,
      keywordCache: this.keywordCache.size,
    };
  }
}

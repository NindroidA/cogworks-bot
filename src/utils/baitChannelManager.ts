import {
  ChannelType,
  type Client,
  type Collection,
  type ColorResolvable,
  EmbedBuilder,
  type Guild,
  type GuildMember,
  type Message,
  PermissionFlagsBits,
  type TextChannel,
} from 'discord.js';
import { Between, LessThan, type Repository } from 'typeorm';
import { AppDataSource } from '../typeorm';
import type { BaitChannelConfig } from '../typeorm/entities/BaitChannelConfig';
import type { BaitChannelLog } from '../typeorm/entities/BaitChannelLog';
import { JoinEvent } from '../typeorm/entities/bait/JoinEvent';
import type { PendingBan as PendingBanEntity } from '../typeorm/entities/PendingBan';
import type { UserActivity } from '../typeorm/entities/UserActivity';
import type { JoinVelocityTracker } from './baitChannel/joinVelocityTracker';
import { analyzeUrls } from './baitChannel/urlAnalyzer';
import { analyzeUsername } from './baitChannel/usernameAnalyzer';
import { Colors } from './colors';
import { ErrorCategory, ErrorSeverity, logError } from './errorHandler';
import { enhancedLogger, LogCategory } from './monitoring/enhancedLogger';

interface PurgeResult {
  totalDeleted: number;
  channelCount: number;
  error?: string;
}

interface PendingBan {
  userId: string;
  messageId: string;
  channelId: string;
  timestamp: number;
  timeoutId: NodeJS.Timeout;
  suspicionScore: number;
  warningMessageId?: string; // ID of the bot's warning reply
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
  };
  reasons: string[];
}

// Config cache TTL: 5 minutes
const CONFIG_CACHE_TTL_MS = 5 * 60 * 1000;

// Activity buffer flush interval: 30 seconds
const ACTIVITY_FLUSH_INTERVAL_MS = 30_000;

interface CachedConfig {
  config: BaitChannelConfig;
  cachedAt: number;
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
  private configCache: Map<string, CachedConfig> = new Map();
  private activityBuffer: Map<string, BufferedActivity> = new Map();
  private activityFlushInterval: ReturnType<typeof setInterval> | null = null;
  private joinVelocityTracker: JoinVelocityTracker | null = null;

  constructor(
    private client: Client,
    private configRepo: Repository<BaitChannelConfig>,
    private logRepo: Repository<BaitChannelLog>,
    private activityRepo: Repository<UserActivity>,
    private pendingBanRepo?: Repository<PendingBanEntity>,
  ) {}

  setJoinVelocityTracker(tracker: JoinVelocityTracker): void {
    this.joinVelocityTracker = tracker;
  }

  /**
   * Initialize: restore unexpired pending bans from DB and clean up expired ones.
   * Call after construction once the bot is ready.
   */
  async initialize(): Promise<void> {
    if (!this.pendingBanRepo) return;

    try {
      // Clean up expired entries
      await this.pendingBanRepo.delete({ expiresAt: LessThan(new Date()) });

      // Load unexpired pending bans and re-create timeouts
      const activeBans = await this.pendingBanRepo.find();
      for (const ban of activeBans) {
        const remainingMs = ban.expiresAt.getTime() - Date.now();
        if (remainingMs <= 0) {
          await this.pendingBanRepo.remove(ban);
          continue;
        }

        const key = `${ban.userId}-${ban.messageId}`;
        const timeoutId = setTimeout(async () => {
          this.pendingBans.delete(key);
          await this.removePendingBanFromDb(ban.userId, ban.messageId, ban.guildId);
        }, remainingMs);

        this.pendingBans.set(key, {
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
        enhancedLogger.info(
          `Restored ${this.pendingBans.size} pending bans from database`,
          LogCategory.SYSTEM,
        );
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

  private async savePendingBanToDb(
    guildId: string,
    pendingBan: PendingBan,
    gracePeriodSeconds: number,
  ): Promise<void> {
    if (!this.pendingBanRepo) return;
    try {
      const entity = this.pendingBanRepo.create({
        guildId,
        userId: pendingBan.userId,
        messageId: pendingBan.messageId,
        channelId: pendingBan.channelId,
        suspicionScore: pendingBan.suspicionScore,
        warningMessageId: pendingBan.warningMessageId || undefined,
        createdAt: new Date(pendingBan.timestamp),
        expiresAt: new Date(pendingBan.timestamp + gracePeriodSeconds * 1000),
      });
      await this.pendingBanRepo.save(entity);
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

  private async removePendingBanFromDb(
    userId: string,
    messageId: string,
    guildId?: string,
  ): Promise<void> {
    if (!this.pendingBanRepo) return;
    try {
      const where: Record<string, string> = { userId, messageId };
      if (guildId) where.guildId = guildId;
      await this.pendingBanRepo.delete(where);
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

  async handleMessage(message: Message): Promise<void> {
    try {
      if (!message.guild || message.author.bot || message.system) return;

      const config = await this.getConfig(message.guild.id);
      if (!config || !config.enabled) {
        enhancedLogger.debug(
          `Bait channel ${!config ? 'not configured' : 'disabled'} for guild ${message.guild.id}`,
          LogCategory.SYSTEM,
        );
        return;
      }

      if (message.channelId !== config.channelId) {
        enhancedLogger.debug(
          `Message in ${message.channelId}, bait channel is ${config.channelId}`,
          LogCategory.SYSTEM,
        );
        return;
      }

      const member = message.member!;

      // Check whitelist
      if (await this.isWhitelisted(member, config)) {
        const whitelistReason = this.getWhitelistReason(member, config);

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
        await this.logToChannelWhitelisted(member, message, config, whitelistReason);

        // Log to database
        await this.logAction(message, 'whitelisted', config);
        return;
      }

      // Perform suspicion analysis
      const analysis = await this.analyzeSuspicion(message, config);

      // Log the attempt
      enhancedLogger.info(
        `Bait channel post from ${member.user.tag} (Score: ${analysis.score}/100)`,
        LogCategory.SECURITY,
        { userId: member.id, score: analysis.score, guildId: message.guild.id },
      );

      // Instant action for high suspicion scores (configurable threshold, default 90)
      if (config.enableSmartDetection && analysis.score >= (config.instantActionThreshold ?? 90)) {
        await this.executeAction(
          member,
          message,
          config,
          analysis,
          'High suspicion score - instant action',
        );
        return;
      }

      // Instant ban mode
      if (config.gracePeriodSeconds === 0) {
        await this.executeAction(member, message, config, analysis, 'Instant action mode');
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

  private async analyzeSuspicion(
    message: Message,
    config: BaitChannelConfig,
  ): Promise<SuspicionAnalysis> {
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
        role =>
          role.name.toLowerCase().includes('verified') ||
          role.name.toLowerCase().includes('member'),
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
      enhancedLogger.debug(
        `Skipped emptyProfile check for ${member.user.tag} (fetch failed)`,
        LogCategory.SECURITY,
      );
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

    // Check for common spam keywords
    const spamKeywords = [
      'free nitro',
      'discord nitro',
      'boost',
      'giveaway',
      'win',
      'click here',
      'check dm',
      'dm me',
      '@everyone',
      '@here',
      'http',
      'www',
      '.gg/',
      'steam',
      'csgo',
      'tf2',
    ];

    const foundKeywords = spamKeywords.filter(keyword => content.includes(keyword));
    if (foundKeywords.length > 0) {
      flags.suspiciousContent = true;
      score += Math.min(25, foundKeywords.length * 8);
      reasons.push(`Suspicious keywords: ${foundKeywords.join(', ')}`);
    }

    // Check join velocity (burst detection)
    if (this.joinVelocityTracker && message.guild) {
      const windowMs = (config.joinVelocityWindowMinutes ?? 5) * 60 * 1000;
      const threshold = config.joinVelocityThreshold ?? 10;
      if (this.joinVelocityTracker.isBurstActive(message.guild.id, threshold, windowMs)) {
        flags.joinBurst = true;
        score += 15;
        const joinCount = this.joinVelocityTracker.getJoinCount(message.guild.id, windowMs);
        reasons.push(
          `Join burst detected (${joinCount} joins in ${config.joinVelocityWindowMinutes ?? 5} min)`,
        );
      }
    }

    // Cap score at 100
    score = Math.min(100, score);

    return { score, flags, reasons };
  }

  private async isWhitelisted(member: GuildMember, config: BaitChannelConfig): Promise<boolean> {
    // Server owner cannot be kicked/banned - always whitelist
    if (member.id === member.guild.ownerId) {
      return true;
    }

    // Check whitelisted users
    if (config.whitelistedUsers?.includes(member.id)) {
      return true;
    }

    // Check whitelisted roles
    const hasWhitelistedRole = member.roles.cache.some(role =>
      config.whitelistedRoles?.includes(role.id),
    );
    if (hasWhitelistedRole) return true;

    // Admins are whitelisted unless disableAdminWhitelist is enabled (for testing)
    if (
      !config.disableAdminWhitelist &&
      member.permissions.has(PermissionFlagsBits.Administrator)
    ) {
      return true;
    }

    return false;
  }

  private getWhitelistReason(member: GuildMember, config: BaitChannelConfig): string {
    // Server owner - cannot be kicked/banned
    if (member.id === member.guild.ownerId) {
      return 'User is the Server Owner';
    }

    // Check user whitelist first
    if (config.whitelistedUsers?.includes(member.id)) {
      return 'User is in manual whitelist';
    }

    // Check role whitelist
    const whitelistedRole = member.roles.cache.find(role =>
      config.whitelistedRoles?.includes(role.id),
    );
    if (whitelistedRole) {
      return `User has whitelisted role: @${whitelistedRole.name}`;
    }

    // Must be admin
    if (member.permissions.has(PermissionFlagsBits.Administrator)) {
      return 'User is an Administrator';
    }

    return 'User is whitelisted';
  }

  private async initiateGracePeriod(
    message: Message,
    config: BaitChannelConfig,
    analysis: SuspicionAnalysis,
  ): Promise<void> {
    const member = message.member!;
    const key = `${member.id}-${message.id}`;

    // Build warning message with suspicion details
    const warningEmbed = new EmbedBuilder()
      .setColor(Colors.status.error)
      .setTitle('URGENT WARNING')
      .setDescription(config.warningMessage)
      .addFields(
        {
          name: '⏰ Action Required',
          value: `Delete your message within **${config.gracePeriodSeconds} seconds** to avoid being ${config.actionType === 'ban' ? 'banned' : 'kicked'}.`,
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
      .setTimestamp()
      .setFooter({ text: message.guild!.name });

    if (analysis.reasons.length > 0) {
      warningEmbed.addFields({
        name: '🔍 Detection Reasons',
        value: analysis.reasons.map(r => `• ${r}`).join('\n'),
      });
    }

    // Reply to the user's message in the channel
    let warningMessage: Message | null = null;
    try {
      warningMessage = await message.reply({ embeds: [warningEmbed] });
    } catch (error) {
      logError({
        category: ErrorCategory.DISCORD_API,
        severity: ErrorSeverity.MEDIUM,
        message: 'Failed to send warning reply to user',
        error,
        context: { userId: member.id, guildId: message.guild!.id },
      });
    }

    // Set up action timer
    const timeoutId = setTimeout(async () => {
      // Check if this pending ban was already handled by handleMessageDelete
      const pendingBan = this.pendingBans.get(key);
      if (!pendingBan) {
        // Already handled - user deleted their message and handleMessageDelete cleaned up
        return;
      }

      try {
        // Try to fetch the original message to see if it still exists
        await message.fetch();

        // Message still exists - remove from pending and execute action
        this.pendingBans.delete(key);
        await this.removePendingBanFromDb(member.id, message.id, message.guild?.id);
        await this.executeAction(member, message, config, analysis, 'Grace period expired');

        // Delete the bot's warning message
        if (warningMessage) {
          try {
            await warningMessage.delete();
          } catch (error) {
            logError({
              category: ErrorCategory.DISCORD_API,
              severity: ErrorSeverity.LOW,
              message: 'Failed to delete warning message',
              error,
              context: { messageId: warningMessage.id },
            });
          }
        }
      } catch {
        // Message was deleted - user complied in time
        // Check again in case handleMessageDelete ran between our check and here
        if (this.pendingBans.has(key)) {
          this.pendingBans.delete(key);
          await this.removePendingBanFromDb(member.id, message.id, message.guild?.id);
          await this.logAction(message, 'deleted-in-time', config, analysis);

          // Delete the bot's warning message since the user complied
          if (warningMessage) {
            try {
              await warningMessage.delete();
            } catch (error) {
              logError({
                category: ErrorCategory.DISCORD_API,
                severity: ErrorSeverity.LOW,
                message: 'Failed to delete warning message after compliance',
                error,
                context: { messageId: warningMessage.id },
              });
            }
          }
        }
      }
    }, config.gracePeriodSeconds * 1000);

    const pendingBanData: PendingBan = {
      userId: member.id,
      messageId: message.id,
      channelId: message.channelId,
      timestamp: Date.now(),
      timeoutId,
      suspicionScore: analysis.score,
      warningMessageId: warningMessage?.id,
    };
    this.pendingBans.set(key, pendingBanData);

    // Persist to DB for crash recovery
    await this.savePendingBanToDb(message.guild!.id, pendingBanData, config.gracePeriodSeconds);
  }

  async handleMessageDelete(messageId: string, guildId: string): Promise<void> {
    try {
      for (const [key, pendingBan] of this.pendingBans.entries()) {
        if (pendingBan.messageId === messageId) {
          clearTimeout(pendingBan.timeoutId);
          this.pendingBans.delete(key);
          await this.removePendingBanFromDb(pendingBan.userId, messageId, guildId);

          const guild = this.client.guilds.cache.get(guildId);
          if (!guild) return;

          // Delete the bot's warning message
          if (pendingBan.warningMessageId && pendingBan.channelId) {
            try {
              const channel = (await guild.channels
                .fetch(pendingBan.channelId)
                .catch(() => null)) as TextChannel | null;
              if (channel) {
                const warningMessage = await channel.messages
                  .fetch(pendingBan.warningMessageId)
                  .catch(() => null);
                if (warningMessage) {
                  await warningMessage.delete();
                }
              }
            } catch (error) {
              logError({
                category: ErrorCategory.DISCORD_API,
                severity: ErrorSeverity.LOW,
                message: 'Failed to delete warning message after user deleted their message',
                error,
                context: {
                  warningMessageId: pendingBan.warningMessageId,
                  channelId: pendingBan.channelId,
                },
              });
            }
          }

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
   * Scan all text channels in a guild and delete recent messages from a banned user.
   * Processes channels sequentially to avoid rate limits.
   */
  private async purgeUserMessages(
    guild: Guild,
    userId: string,
    baitChannelId: string,
  ): Promise<PurgeResult> {
    let totalDeleted = 0;
    let channelCount = 0;

    try {
      const channels = guild.channels.cache.filter(
        ch =>
          (ch.type === ChannelType.GuildText ||
            ch.type === ChannelType.GuildAnnouncement ||
            ch.type === ChannelType.GuildVoice) &&
          ch.id !== baitChannelId,
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
          enhancedLogger.debug(
            `Purge: failed to process channel ${channel.id}`,
            LogCategory.SECURITY,
            { channelId: channel.id, userId, error: (error as Error).message },
          );
        }
      }

      if (totalDeleted > 0) {
        enhancedLogger.info(
          `Purged ${totalDeleted} messages across ${channelCount} channels for user ${userId}`,
          LogCategory.SECURITY,
          { userId, guildId: guild.id, totalDeleted, channelCount },
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
  ): Promise<void> {
    let actionTaken: string = config.actionType;
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

    // Step 2: Execute the configured action
    try {
      switch (config.actionType) {
        case 'ban':
          await member.ban({
            reason: `${config.banReason} (${reason})`,
            deleteMessageSeconds: config.deleteUserMessages
              ? config.deleteMessageDays * 24 * 60 * 60
              : 0,
          });
          enhancedLogger.info(
            `Banned user ${member.user.tag} (Score: ${analysis.score})`,
            LogCategory.SECURITY,
            {
              userId: member.id,
              score: analysis.score,
              action: 'ban',
              guildId: message.guild!.id,
            },
          );
          break;

        case 'kick':
          await member.kick(`${config.banReason} (${reason})`);
          enhancedLogger.info(
            `Kicked user ${member.user.tag} (Score: ${analysis.score})`,
            LogCategory.SECURITY,
            {
              userId: member.id,
              score: analysis.score,
              action: 'kick',
              guildId: message.guild!.id,
            },
          );
          break;

        case 'log-only':
          enhancedLogger.info(
            `Logged user ${member.user.tag} (Score: ${analysis.score}) - no action taken`,
            LogCategory.SECURITY,
            {
              userId: member.id,
              score: analysis.score,
              action: 'log-only',
              guildId: message.guild!.id,
            },
          );
          actionTaken = 'logged';
          break;

        default:
          enhancedLogger.warn(`Unknown action type: ${config.actionType}`, LogCategory.ERROR, {
            actionType: config.actionType,
            guildId: message.guild!.id,
          });
      }
    } catch (error) {
      const err = error as Error;
      actionResult = 'failed';
      failureReason = err.message;
      actionTaken = 'failed';

      enhancedLogger.error(
        `Failed to execute action ${config.actionType} for ${member.user.tag}`,
        err,
        LogCategory.ERROR,
        {
          userId: member.id,
          action: config.actionType,
          guildId: message.guild!.id,
        },
      );

      logError({
        category: ErrorCategory.DISCORD_API,
        severity: ErrorSeverity.HIGH,
        message: `Failed to execute bait channel action: ${config.actionType}`,
        error,
        context: {
          userId: member.id,
          guildId: message.guild!.id,
          action: config.actionType,
        },
      });
    }

    // Step 3: Purge user messages across all channels (ban only)
    let purgeResult: PurgeResult | undefined;
    if (actionResult === 'success' && config.actionType === 'ban' && message.guild) {
      purgeResult = await this.purgeUserMessages(message.guild, member.id, config.channelId);
    }

    // Step 4: Detect repeat offenders (for ban/kick actions only)
    let repeatOffenderResult: RepeatOffenderResult | null = null;
    if (actionResult === 'success' && config.actionType !== 'log-only' && member.joinedAt) {
      repeatOffenderResult = await this.detectRepeatOffenders(member, message.guild!.id);
    }

    // Step 5: Log to channel AFTER purge (with result)
    await this.logToChannel(
      member,
      message,
      config,
      analysis,
      reason,
      actionResult,
      failureReason,
      purgeResult,
      repeatOffenderResult,
    );

    // Step 6: Log to database
    await this.logAction(message, actionTaken, config, analysis, failureReason);
  }

  /**
   * Detect accounts that joined around the same time with similar suspicious characteristics.
   * Returns null if fewer than 3 matching accounts are found (not enough evidence).
   */
  private async detectRepeatOffenders(
    member: GuildMember,
    guildId: string,
  ): Promise<RepeatOffenderResult | null> {
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
      enhancedLogger.debug(
        `Failed to detect repeat offenders for ${member.user.tag}`,
        LogCategory.DATABASE,
        { error: (error as Error).message },
      );
      return null;
    }
  }

  private async logAction(
    message: Message,
    action: string,
    _config: BaitChannelConfig,
    analysis?: SuspicionAnalysis,
    failureReason?: string,
  ): Promise<void> {
    try {
      const member = message.member!;
      const userActivity = await this.activityRepo.findOne({
        where: { guildId: message.guild!.id, userId: member.id },
      });

      const accountAgeDays = (Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24);
      const membershipMinutes = (Date.now() - member.joinedTimestamp!) / (1000 * 60);

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
          userId: message.author.id,
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
    actionResult: 'success' | 'failed' = 'success',
    failureReason?: string,
    purgeResult?: PurgeResult,
    repeatOffenderResult?: RepeatOffenderResult | null,
  ): Promise<void> {
    if (!config.logChannelId) return;

    try {
      const logChannel = (await message
        .guild!.channels.fetch(config.logChannelId)
        .catch(() => null)) as TextChannel | null;
      if (!logChannel) return;

      // Different display for success vs failure
      let actionEmoji: string;
      let actionText: string;
      let color: ColorResolvable;

      if (actionResult === 'failed') {
        actionEmoji = '';
        actionText = `${config.actionType === 'ban' ? 'Ban' : 'Kick'} FAILED`;
        color = Colors.status.neutral; // Gray for failure
      } else {
        actionEmoji =
          {
            ban: '',
            kick: '',
            'log-only': '',
          }[config.actionType] || '';

        actionText =
          {
            ban: 'Banned',
            kick: 'Kicked',
            'log-only': 'Logged (No action)',
          }[config.actionType] || 'Action taken';

        color =
          analysis.score >= 90
            ? Colors.severity.critical
            : analysis.score >= 70
              ? Colors.severity.high
              : analysis.score >= 50
                ? Colors.severity.medium
                : Colors.status.warning;
      }

      const description =
        actionResult === 'failed'
          ? `**${member.user.tag}** triggered the bait channel but the action failed`
          : `**${member.user.tag}** triggered the bait channel`;

      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`${actionEmoji} Bait Channel ${actionText}`)
        .setDescription(description)
        .addFields(
          {
            name: '👤 User',
            value: `${member.user.tag}\n\`${member.id}\``,
            inline: true,
          },
          {
            name: '🎭 Roles',
            value:
              member.roles.cache.size > 1 ? `${member.roles.cache.size - 1} roles` : 'No roles',
            inline: true,
          },
          { name: '⚡ Reason', value: reason, inline: false },
          {
            name: '📅 Account Created',
            value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
            inline: true,
          },
          {
            name: '📥 Joined Server',
            value: `<t:${Math.floor(member.joinedTimestamp! / 1000)}:R>`,
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
          value: analysis.reasons.map(r => `• ${r}`).join('\n'),
        });
      }

      // Add failure reason if action failed
      if (actionResult === 'failed' && failureReason) {
        embed.addFields({
          name: '⚠️ Failure Reason',
          value:
            failureReason.length > 1024 ? `${failureReason.substring(0, 1021)}...` : failureReason,
        });
      }

      if (message.content) {
        embed.addFields({
          name: '💬 Message Content',
          value:
            message.content.length > 1024
              ? `${message.content.substring(0, 1021)}...`
              : message.content,
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

      // Add repeat offender annotation if detected
      if (repeatOffenderResult && repeatOffenderResult.matchCount > 0) {
        const matchList = repeatOffenderResult.matchingUsers
          .slice(0, 10) // Cap display at 10
          .map(u => `• <@${u.userId}> — joined <t:${Math.floor(u.joinedAt.getTime() / 1000)}:R>`)
          .join('\n');
        embed.addFields({
          name: '🚨 Possible Coordinated Raid',
          value: `${repeatOffenderResult.matchCount} similar account(s) joined around the same time:\n${matchList}`,
        });
      }

      embed.setTimestamp();

      await logChannel.send({ embeds: [embed] });
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
            value:
              member.roles.cache.size > 1 ? `${member.roles.cache.size - 1} roles` : 'No roles',
            inline: true,
          },
          {
            name: '🛡️ Whitelist Reason',
            value: whitelistReason,
            inline: false,
          },
          {
            name: '📅 Account Created',
            value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
            inline: true,
          },
          {
            name: '📥 Joined Server',
            value: `<t:${Math.floor(member.joinedTimestamp! / 1000)}:R>`,
            inline: true,
          },
        )
        .setThumbnail(member.user.displayAvatarURL());

      if (message.content) {
        embed.addFields({
          name: '💬 Message Content',
          value:
            message.content.length > 1024
              ? `${message.content.substring(0, 1021)}...`
              : message.content,
        });
      }

      if (message.attachments.size > 0) {
        embed.addFields({
          name: '📎 Attachments',
          value: `${message.attachments.size} attachment(s)`,
        });
      }

      embed.setTimestamp();

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
      // Check cache first (with TTL)
      const cached = this.configCache.get(guildId);
      if (cached && Date.now() - cached.cachedAt < CONFIG_CACHE_TTL_MS) {
        return cached.config;
      }

      // Evict stale entry if expired
      if (cached) {
        this.configCache.delete(guildId);
      }

      // Fetch from database
      const config = await this.configRepo.findOne({ where: { guildId } });
      if (config) {
        this.configCache.set(guildId, { config, cachedAt: Date.now() });
      }

      return config;
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

  public clearConfigCache(guildId: string): void {
    this.configCache.delete(guildId);
  }

  // Track user activity in-memory, flushed to DB periodically
  async trackMessage(message: Message): Promise<void> {
    if (!message.guild || message.author.bot) return;

    // Skip activity tracking if bait channel isn't configured/enabled for this guild
    const config = await this.getConfig(message.guild.id);
    if (!config || !config.enabled) return;

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

    for (const [key, buffered] of toFlush) {
      try {
        const [guildId, userId] = key.split(':');
        let activity = await this.activityRepo.findOne({
          where: { guildId, userId },
        });

        if (!activity) {
          activity = this.activityRepo.create({
            guildId,
            userId,
            messageCount: buffered.messageCount,
            firstMessageAt: buffered.firstMessageAt,
            lastMessageAt: buffered.lastMessageAt,
            joinedAt: buffered.joinedAt,
          });
        } else {
          activity.messageCount += buffered.messageCount;
          activity.lastMessageAt = buffered.lastMessageAt;
        }

        await this.activityRepo.save(activity);
      } catch (error) {
        logError({
          category: ErrorCategory.DATABASE,
          severity: ErrorSeverity.LOW,
          message: 'Failed to flush user activity buffer',
          error,
          context: { key },
        });
      }
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
    }, ACTIVITY_FLUSH_INTERVAL_MS);
  }

  stopActivityFlush(): void {
    if (this.activityFlushInterval) {
      clearInterval(this.activityFlushInterval);
      this.activityFlushInterval = null;
    }
  }
}

import {
  type Client,
  type ColorResolvable,
  EmbedBuilder,
  type GuildMember,
  type Message,
  PermissionFlagsBits,
  type TextChannel,
} from 'discord.js';
import type { Repository } from 'typeorm';
import type { BaitChannelConfig } from '../typeorm/entities/BaitChannelConfig';
import type { BaitChannelLog } from '../typeorm/entities/BaitChannelLog';
import type { UserActivity } from '../typeorm/entities/UserActivity';
import { Colors } from './colors';
import { ErrorCategory, ErrorSeverity, logError } from './errorHandler';
import { enhancedLogger, LogCategory } from './index';

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
  };
  reasons: string[];
}

export class BaitChannelManager {
  private pendingBans: Map<string, PendingBan> = new Map();
  private configCache: Map<string, BaitChannelConfig> = new Map();

  constructor(
    private client: Client,
    private configRepo: Repository<BaitChannelConfig>,
    private logRepo: Repository<BaitChannelLog>,
    private activityRepo: Repository<UserActivity>,
  ) {}

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

      // Instant action for high suspicion scores (90+)
      if (config.enableSmartDetection && analysis.score >= 90) {
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

    // Content analysis
    const content = message.content.toLowerCase();

    // Check for links (common in spam)
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const links = content.match(urlRegex) || [];
    if (links.length > 0) {
      flags.linkSpam = true;
      score += Math.min(20, links.length * 10);
      reasons.push(`Contains ${links.length} link(s)`);
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

    this.pendingBans.set(key, {
      userId: member.id,
      messageId: message.id,
      channelId: message.channelId,
      timestamp: Date.now(),
      timeoutId,
      suspicionScore: analysis.score,
      warningMessageId: warningMessage?.id,
    });
  }

  async handleMessageDelete(messageId: string, guildId: string): Promise<void> {
    try {
      for (const [key, pendingBan] of this.pendingBans.entries()) {
        if (pendingBan.messageId === messageId) {
          clearTimeout(pendingBan.timeoutId);
          this.pendingBans.delete(key);

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
            { userId: member.id, score: analysis.score, action: 'ban', guildId: message.guild!.id },
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
        { userId: member.id, action: config.actionType, guildId: message.guild!.id },
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

    // Step 3: Log to channel AFTER action (with result)
    await this.logToChannel(member, message, config, analysis, reason, actionResult, failureReason);

    // Step 4: Log to database
    await this.logAction(message, actionTaken, config, analysis, failureReason);
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
          { name: '👤 User', value: `${member.user.tag}\n\`${member.id}\``, inline: true },
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
          { name: '📊 Suspicion Score', value: `**${analysis.score}/100**`, inline: true },
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
          { name: '👤 User', value: `${member.user.tag}\n\`${member.id}\``, inline: true },
          {
            name: '🎭 Roles',
            value:
              member.roles.cache.size > 1 ? `${member.roles.cache.size - 1} roles` : 'No roles',
            inline: true,
          },
          { name: '🛡️ Whitelist Reason', value: whitelistReason, inline: false },
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
      // Check cache first
      if (this.configCache.has(guildId)) {
        return this.configCache.get(guildId)!;
      }

      // Fetch from database
      const config = await this.configRepo.findOne({ where: { guildId } });
      if (config) {
        this.configCache.set(guildId, config);
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

  // Track user activity for better detection
  async trackMessage(message: Message): Promise<void> {
    try {
      if (!message.guild || message.author.bot) return;

      let activity = await this.activityRepo.findOne({
        where: { guildId: message.guild.id, userId: message.author.id },
      });

      if (!activity) {
        activity = this.activityRepo.create({
          guildId: message.guild.id,
          userId: message.author.id,
          messageCount: 1,
          firstMessageAt: new Date(),
          lastMessageAt: new Date(),
          joinedAt: message.member?.joinedAt || new Date(),
        });
      } else {
        activity.messageCount++;
        activity.lastMessageAt = new Date();
      }

      await this.activityRepo.save(activity);
    } catch (error) {
      logError({
        category: ErrorCategory.DATABASE,
        severity: ErrorSeverity.LOW,
        message: 'Failed to track user activity',
        error,
        context: {
          guildId: message.guild?.id,
          userId: message.author.id,
        },
      });
    }
  }
}

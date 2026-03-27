import type { Client, MessageReaction, PartialMessageReaction, PartialUser, TextChannel, User } from 'discord.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { StarboardConfig } from '../typeorm/entities/starboard/StarboardConfig';
import { StarboardEntry } from '../typeorm/entities/starboard/StarboardEntry';
import { enhancedLogger, LogCategory } from '../utils';
import { CACHE_TTL } from '../utils/constants';
import { lazyRepo } from '../utils/database/lazyRepo';

const configRepo = lazyRepo(StarboardConfig);
const entryRepo = lazyRepo(StarboardEntry);

// In-memory config cache: Map<guildId, { config, cachedAt }>
const configCache = new Map<string, { config: StarboardConfig; cachedAt: number }>();

/** Invalidate starboard cache for a guild (call on config change or guild leave) */
export function invalidateStarboardCache(guildId: string): void {
  configCache.delete(guildId);
}

/** Get starboard config with TTL cache */
async function getStarboardConfig(guildId: string): Promise<StarboardConfig | null> {
  const cached = configCache.get(guildId);
  if (cached) {
    if (Date.now() - cached.cachedAt > CACHE_TTL.STARBOARD_CONFIG) {
      configCache.delete(guildId);
    } else {
      return cached.config;
    }
  }

  const config = await configRepo.findOneBy({ guildId });
  if (config) {
    configCache.set(guildId, { config, cachedAt: Date.now() });
  }
  return config;
}

/** Get gold-gradient color based on star count */
function getStarColor(count: number): number {
  if (count >= 15) return 0xffd700; // Bright gold
  if (count >= 10) return 0xffbf00; // Gold
  if (count >= 5) return 0xffac33; // Light gold
  return 0xf4c542; // Pale gold
}

/** Build the starboard embed for a message */
function buildStarboardEmbed(
  content: string | null,
  authorTag: string,
  authorAvatarUrl: string | null,
  starCount: number,
  channelName: string,
  attachmentUrl: string | null,
  messageLink: string,
): { embed: EmbedBuilder; row: ActionRowBuilder<ButtonBuilder> } {
  const embed = new EmbedBuilder()
    .setAuthor({
      name: authorTag,
      iconURL: authorAvatarUrl || undefined,
    })
    .setColor(getStarColor(starCount))
    .setFooter({ text: `\u2B50 ${starCount} | #${channelName}` });

  if (content) {
    embed.setDescription(content.slice(0, 4096));
  }

  if (attachmentUrl) {
    embed.setImage(attachmentUrl);
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setLabel('Jump to Original').setStyle(ButtonStyle.Link).setURL(messageLink),
  );

  return { embed, row };
}

/** Handle messageReactionAdd for starboard */
export async function handleStarboardReactionAdd(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  _client: Client,
): Promise<void> {
  if (user.bot) return;

  try {
    // Fetch partials if needed
    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch {
        return;
      }
    }
    if (reaction.message.partial) {
      try {
        await reaction.message.fetch();
      } catch {
        return;
      }
    }

    const message = reaction.message;
    if (!message.guild) return;

    const guildId = message.guild.id;
    const config = await getStarboardConfig(guildId);
    if (!config || !config.enabled) return;

    // Check if emoji matches
    const reactionEmoji = reaction.emoji.name || reaction.emoji.toString();
    if (reactionEmoji !== config.emoji && reaction.emoji.toString() !== config.emoji) return;

    // Check if channel is ignored
    if (config.ignoredChannels?.includes(message.channelId)) return;

    // Don't star messages in the starboard channel itself
    if (message.channelId === config.channelId) return;

    // Check ignoreBots
    if (config.ignoreBots && message.author?.bot) return;

    // Check ignoreNSFW
    const channel = message.channel;
    if (config.ignoreNSFW && 'nsfw' in channel && channel.nsfw) return;

    // Count reactions (excluding self-star if disabled)
    let reactionCount = reaction.count ?? 0;
    if (!config.selfStar && message.author) {
      // Check if the author reacted — if so, subtract 1
      const users = await reaction.users.fetch();
      if (users.has(message.author.id)) {
        reactionCount -= 1;
      }
    }

    if (reactionCount < config.threshold) return;

    // Check if entry already exists
    const existingEntry = await entryRepo.findOneBy({
      guildId,
      originalMessageId: message.id,
    });

    const starboardChannel = message.guild.channels.cache.get(config.channelId) as TextChannel | undefined;
    if (!starboardChannel) {
      enhancedLogger.warn('Starboard channel not found, disabling starboard', LogCategory.SYSTEM, {
        guildId,
        channelId: config.channelId,
      });
      config.enabled = false;
      await configRepo.save(config);
      invalidateStarboardCache(guildId);
      return;
    }

    const messageLink = `https://discord.com/channels/${guildId}/${message.channelId}/${message.id}`;
    const authorTag = message.author?.tag || '[Unknown]';
    const authorAvatarUrl = message.author?.displayAvatarURL() || null;
    const content = message.content || null;
    const attachmentUrl = message.attachments.first()?.url || null;
    const channelName = 'name' in message.channel ? (message.channel.name as string) : message.channelId;

    if (existingEntry) {
      // Update star count
      existingEntry.starCount = reactionCount;
      await entryRepo.save(existingEntry);

      // Update the starboard message embed
      try {
        const starboardMsg = await starboardChannel.messages.fetch(existingEntry.starboardMessageId);
        const { embed, row } = buildStarboardEmbed(
          existingEntry.content,
          authorTag,
          authorAvatarUrl,
          reactionCount,
          channelName,
          existingEntry.attachmentUrl,
          messageLink,
        );
        await starboardMsg.edit({ embeds: [embed], components: [row] });
      } catch {
        // Starboard message may have been deleted — ignore
      }
    } else {
      // Create new starboard entry
      const { embed, row } = buildStarboardEmbed(
        content,
        authorTag,
        authorAvatarUrl,
        reactionCount,
        channelName,
        attachmentUrl,
        messageLink,
      );

      const starboardMsg = await starboardChannel.send({
        embeds: [embed],
        components: [row],
      });

      const entry = entryRepo.create({
        guildId,
        originalMessageId: message.id,
        originalChannelId: message.channelId,
        authorId: message.author?.id || '0',
        starboardMessageId: starboardMsg.id,
        starCount: reactionCount,
        content,
        attachmentUrl,
      });

      await entryRepo.save(entry);
    }
  } catch (error) {
    enhancedLogger.error('Error handling starboard reaction add', error as Error, LogCategory.SYSTEM, {
      messageId: reaction.message.id,
    });
  }
}

/** Handle messageReactionRemove for starboard */
export async function handleStarboardReactionRemove(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  _client: Client,
): Promise<void> {
  if (user.bot) return;

  try {
    // Fetch partials if needed
    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch {
        return;
      }
    }
    if (reaction.message.partial) {
      try {
        await reaction.message.fetch();
      } catch {
        return;
      }
    }

    const message = reaction.message;
    if (!message.guild) return;

    const guildId = message.guild.id;
    const config = await getStarboardConfig(guildId);
    if (!config || !config.enabled) return;

    // Check if emoji matches
    const reactionEmoji = reaction.emoji.name || reaction.emoji.toString();
    if (reactionEmoji !== config.emoji && reaction.emoji.toString() !== config.emoji) return;

    // Check if we have an entry for this message
    const existingEntry = await entryRepo.findOneBy({
      guildId,
      originalMessageId: message.id,
    });

    if (!existingEntry) return;

    // Recount reactions (excluding self-star if disabled)
    let reactionCount = reaction.count ?? 0;
    if (!config.selfStar && message.author) {
      const users = await reaction.users.fetch();
      if (users.has(message.author.id)) {
        reactionCount -= 1;
      }
    }

    // Update the entry count (don't remove — keep it even if below threshold)
    existingEntry.starCount = reactionCount;
    await entryRepo.save(existingEntry);

    // Update the starboard message embed
    const starboardChannel = message.guild.channels.cache.get(config.channelId) as TextChannel | undefined;
    if (!starboardChannel) return;

    try {
      const starboardMsg = await starboardChannel.messages.fetch(existingEntry.starboardMessageId);
      const messageLink = `https://discord.com/channels/${guildId}/${message.channelId}/${message.id}`;
      const authorTag = message.author?.tag || '[Unknown]';
      const authorAvatarUrl = message.author?.displayAvatarURL() || null;
      const channelName = 'name' in message.channel ? (message.channel.name as string) : message.channelId;

      const { embed, row } = buildStarboardEmbed(
        existingEntry.content,
        authorTag,
        authorAvatarUrl,
        reactionCount,
        channelName,
        existingEntry.attachmentUrl,
        messageLink,
      );
      await starboardMsg.edit({ embeds: [embed], components: [row] });
    } catch {
      // Starboard message may have been deleted — ignore
    }
  } catch (error) {
    enhancedLogger.error('Error handling starboard reaction remove', error as Error, LogCategory.SYSTEM, {
      messageId: reaction.message.id,
    });
  }
}

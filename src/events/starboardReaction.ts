import type {
  APIMessage,
  Client,
  MessageReaction,
  PartialMessageReaction,
  PartialUser,
  TextChannel,
  User,
} from 'discord.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Routes } from 'discord.js';
import { StarboardConfig } from '../typeorm/entities/starboard/StarboardConfig';
import { StarboardEntry } from '../typeorm/entities/starboard/StarboardEntry';
import { enhancedLogger, fetchPartial, LogCategory, verifiedMessageDelete } from '../utils';
import { lazyRepo } from '../utils/database/lazyRepo';
import { getStarboardConfig, invalidateStarboardCache } from '../utils/starboard/configCache';

// The config cache moved to utils so the /starboard commands can invalidate it; re-exported for existing callers.
export { invalidateStarboardCache };

const configRepo = lazyRepo(StarboardConfig);
const entryRepo = lazyRepo(StarboardEntry);

/** Get gold-gradient color based on star count */
function getStarColor(count: number): number {
  if (count >= 15) return 0xffd700; // Bright gold
  if (count >= 10) return 0xffbf00; // Gold
  if (count >= 5) return 0xffac33; // Light gold
  return 0xf4c542; // Pale gold
}

function starFooter(starCount: number, channelName: string): string {
  return `\u2B50 ${starCount} | #${channelName}`;
}

type AnyReaction = MessageReaction | PartialMessageReaction;

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
    .setFooter({ text: starFooter(starCount, channelName) });

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

function emojiMatches(reaction: AnyReaction, config: StarboardConfig): boolean {
  const reactionEmoji = reaction.emoji.name || reaction.emoji.toString();
  return reactionEmoji === config.emoji || reaction.emoji.toString() === config.emoji;
}

/**
 * Live count for the reaction's emoji, read from the API. `reaction.count`
 * can't be used: the client's reaction cache is disabled (ReactionManager: 0),
 * so discord.js reports 1 for a cached message and 0 after a partial fetch,
 * whatever the real total is. Returns null when the message is gone.
 */
async function fetchReactionCount(client: Client, reaction: AnyReaction): Promise<number | null> {
  const { channelId, id: messageId } = reaction.message;
  const { id: emojiId, name: emojiName } = reaction.emoji;
  try {
    const raw = (await client.rest.get(Routes.channelMessage(channelId, messageId))) as APIMessage;
    const match = raw.reactions?.find(r => (emojiId ? r.emoji.id === emojiId : r.emoji.name === emojiName));
    return match?.count ?? 0;
  } catch (error) {
    enhancedLogger.debug('Skipping starboard reaction — message fetch failed (likely deleted)', LogCategory.SYSTEM, {
      messageId,
      reason: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Update the star count on an existing starboard post, keeping the rest of the embed as posted */
async function refreshStarboardPost(
  starboardChannel: TextChannel,
  entry: StarboardEntry,
  starCount: number,
  channelName: string,
): Promise<void> {
  try {
    const starboardMsg = await starboardChannel.messages.fetch(entry.starboardMessageId);
    const [current] = starboardMsg.embeds;
    if (!current) return;
    const embed = EmbedBuilder.from(current)
      .setColor(getStarColor(starCount))
      .setFooter({ text: starFooter(starCount, channelName) });
    await starboardMsg.edit({ embeds: [embed] });
  } catch (error) {
    // Starboard message may have been deleted
    enhancedLogger.debug('Starboard post refresh skipped', LogCategory.SYSTEM, {
      guildId: entry.guildId,
      starboardMessageId: entry.starboardMessageId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Per-message promise chain. Two stars landing together used to both see "no
 * entry yet" and both post, leaving an untracked duplicate. Serializing
 * count → check → post → insert per message means the second event finds the
 * first one's entry and updates it instead. The bot is a single process, so
 * an in-memory lock is enough.
 */
const messageLocks = new Map<string, Promise<void>>();

function withMessageLock(key: string, task: () => Promise<void>): Promise<void> {
  const run = (messageLocks.get(key) ?? Promise.resolve()).then(task);
  // The stored tail never rejects, so one failed task can't wedge the key
  const tail = run.catch(() => {});
  messageLocks.set(key, tail);
  void tail.then(() => {
    if (messageLocks.get(key) === tail) messageLocks.delete(key);
  });
  return run;
}

/**
 * Bring the starboard in line with a message's current star count: post it
 * once it reaches the threshold (add path only), otherwise refresh the count
 * on its existing post. Runs under the per-message lock.
 */
async function syncStarboardEntry(
  reaction: AnyReaction,
  client: Client,
  config: StarboardConfig,
  allowCreate: boolean,
): Promise<void> {
  const message = reaction.message;
  const guild = message.guild;
  if (!guild) return;
  const guildId = guild.id;

  // Read inside the lock, so a concurrent star sees the entry the first one created
  const existingEntry = await entryRepo.findOneBy({ guildId, originalMessageId: message.id });
  if (!existingEntry && !allowCreate) return;

  let starCount = await fetchReactionCount(client, reaction);
  if (starCount === null) return;
  // A raw count below the threshold can never pass — skip the message and users fetches
  if (!existingEntry && starCount < config.threshold) return;

  // A new post needs the message itself (author, content, attachments)
  if (!existingEntry) {
    if (message.partial && !(await fetchPartial(message, 'message'))) return;
    if (config.ignoreBots && message.author?.bot) return;
  }

  // Don't count the author's own star unless self-star is on
  const authorId = existingEntry?.authorId ?? message.author?.id;
  if (!config.selfStar && authorId) {
    const users = await reaction.users.fetch();
    if (users.has(authorId)) {
      starCount -= 1;
    }
  }

  if (!existingEntry && starCount < config.threshold) return;

  const starboardChannel = guild.channels.cache.get(config.channelId) as TextChannel | undefined;
  if (!starboardChannel) {
    enhancedLogger.warn('Starboard channel not found, disabling starboard', LogCategory.SYSTEM, {
      guildId,
      channelId: config.channelId,
    });
    // Targeted update: saving the cached entity could overwrite newer settings
    await configRepo.update({ guildId }, { enabled: false });
    invalidateStarboardCache(guildId);
    return;
  }

  const channel = message.channel;
  const channelName = channel && 'name' in channel && channel.name ? channel.name : message.channelId;

  if (existingEntry) {
    // Keep the entry even if it drops below the threshold
    existingEntry.starCount = starCount;
    await entryRepo.save(existingEntry);
    await refreshStarboardPost(starboardChannel, existingEntry, starCount, channelName);
    return;
  }

  const messageLink = `https://discord.com/channels/${guildId}/${message.channelId}/${message.id}`;
  const content = message.content || null;
  const attachmentUrl = message.attachments.first()?.url || null;
  const { embed, row } = buildStarboardEmbed(
    content,
    message.author?.tag || '[Unknown]',
    message.author?.displayAvatarURL() || null,
    starCount,
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
    starCount,
    content,
    attachmentUrl,
  });

  try {
    await entryRepo.save(entry);
  } catch (error) {
    // An untracked post can never be updated or cleaned up — take it back down
    await verifiedMessageDelete(starboardMsg, { guildId, label: 'untracked starboard post' });
    throw error;
  }
}

/**
 * Starboard config for this reaction's guild, or null when the guild has no
 * enabled starboard or the emoji isn't its star. Needs only what a partial
 * reaction carries, so unrelated reactions never trigger a REST fetch.
 */
async function getConfigForReaction(reaction: AnyReaction): Promise<StarboardConfig | null> {
  const guildId = reaction.message.guild?.id;
  if (!guildId) return null;
  const config = await getStarboardConfig(guildId);
  if (!config?.enabled || !emojiMatches(reaction, config)) return null;
  return config;
}

/** Handle messageReactionAdd for starboard */
export async function handleStarboardReactionAdd(
  reaction: AnyReaction,
  user: User | PartialUser,
  client: Client,
): Promise<void> {
  if (user.bot) return;

  try {
    const config = await getConfigForReaction(reaction);
    if (!config) return;

    const message = reaction.message;

    // Check if channel is ignored
    if (config.ignoredChannels?.includes(message.channelId)) return;

    // Don't star messages in the starboard channel itself
    if (message.channelId === config.channelId) return;

    // Check ignoreNSFW (the channel comes from the client cache, even for a partial message)
    const channel = message.channel;
    if (config.ignoreNSFW && channel && 'nsfw' in channel && channel.nsfw) return;

    // A cached message already names its author, so a bot post is skipped before
    // any REST call. A partial message is checked after its fetch, in syncStarboardEntry.
    if (!message.partial && config.ignoreBots && message.author?.bot) return;

    await withMessageLock(`${config.guildId}:${message.id}`, () => syncStarboardEntry(reaction, client, config, true));
  } catch (error) {
    enhancedLogger.error('Error handling starboard reaction add', error as Error, LogCategory.SYSTEM, {
      messageId: reaction.message.id,
    });
  }
}

/** Handle messageReactionRemove for starboard */
export async function handleStarboardReactionRemove(
  reaction: AnyReaction,
  user: User | PartialUser,
  client: Client,
): Promise<void> {
  if (user.bot) return;

  try {
    const config = await getConfigForReaction(reaction);
    if (!config) return;

    await withMessageLock(`${config.guildId}:${reaction.message.id}`, () =>
      syncStarboardEntry(reaction, client, config, false),
    );
  } catch (error) {
    enhancedLogger.error('Error handling starboard reaction remove', error as Error, LogCategory.SYSTEM, {
      messageId: reaction.message.id,
    });
  }
}

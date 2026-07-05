import type { ForumChannel, GuildForumTag } from 'discord.js';
import { enhancedLogger, LogCategory } from './monitoring/enhancedLogger';
import { sleep } from './time';

/**
 * Creates or finds a forum tag based on custom ticket type properties.
 * Returns null when the forum is at Discord's 20-tag limit, when the tag can't
 * be located after creation, or on API error — callers should skip the tag
 * rather than pass `null`/`''` downstream.
 * @param forumChannel - The forum channel to manage tags in
 * @param typeId - The custom ticket type ID (e.g., "ban_appeal", "bug_report")
 * @param displayName - The display name for the tag
 * @param emoji - Optional emoji for the tag
 * @returns The tag ID (snowflake string) or null on failure
 */
export async function ensureForumTag(
  forumChannel: ForumChannel,
  typeId: string,
  displayName: string,
  emoji: string | null,
): Promise<string | null> {
  try {
    // Check if tag already exists (by name)
    const existingTag = forumChannel.availableTags.find(tag => tag.name.toLowerCase() === displayName.toLowerCase());

    if (existingTag) {
      enhancedLogger.info(`Forum tag "${displayName}" already exists`, LogCategory.SYSTEM, {
        tagId: existingTag.id,
        forumId: forumChannel.id,
      });
      return existingTag.id;
    }

    // Discord API limit: 20 tags per forum channel
    if (forumChannel.availableTags.length >= 20) {
      enhancedLogger.warn(
        `Forum channel has reached maximum tag limit (20), cannot create tag for ${displayName}`,
        LogCategory.SYSTEM,
        {
          forumId: forumChannel.id,
        },
      );
      return null;
    }

    // Create new tag data (Discord.js will assign ID)
    const newTagData: Partial<GuildForumTag> = {
      name: displayName,
      moderated: false,
    };

    // Add emoji if provided
    if (emoji) {
      // Check if emoji is a unicode emoji or custom emoji ID
      const customEmojiMatch = emoji.match(/<a?:(\w+):(\d+)>/);
      if (customEmojiMatch) {
        // Custom emoji - use ID
        newTagData.emoji = {
          id: customEmojiMatch[2],
          name: customEmojiMatch[1],
        };
      } else {
        // Unicode emoji
        newTagData.emoji = {
          id: null,
          name: emoji,
        };
      }
    }

    // Update forum channel with new tag
    const updatedTags = [...forumChannel.availableTags, newTagData as GuildForumTag];
    await forumChannel.setAvailableTags(updatedTags);

    // Wait a moment for Discord to process the change
    await sleep(500);

    // Fetch the created tag ID (it's the last one added)
    const refreshedChannel = (await forumChannel.fetch()) as ForumChannel;
    const createdTag = refreshedChannel.availableTags.find(tag => tag.name.toLowerCase() === displayName.toLowerCase());

    if (!createdTag) {
      enhancedLogger.error(
        `Tag "${displayName}" was created but could not be found after refresh`,
        new Error('Tag not found after creation'),
        LogCategory.ERROR,
        { forumId: forumChannel.id, displayName },
      );
      return null;
    }

    enhancedLogger.info(`Created forum tag "${displayName}"`, LogCategory.SYSTEM, {
      tagId: createdTag.id,
      forumId: forumChannel.id,
      emoji,
    });

    return createdTag.id;
  } catch (error) {
    enhancedLogger.error(`Failed to create/find forum tag for ${displayName}`, error as Error, LogCategory.ERROR, {
      forumId: forumChannel.id,
      typeId,
    });
    return null;
  }
}

/**
 * Applies forum tags to a forum post/thread, ACCUMULATING onto whatever tags
 * the thread already carries (the "Forum Tag System" rule in CLAUDE.md) —
 * `setAppliedTags` replaces, so passing only the caller's list used to wipe
 * any tag a moderator had added to the thread by hand.
 * @param forumChannel - The forum channel containing the thread
 * @param threadId - The thread/post ID to apply tags to
 * @param tagIds - Array of tag IDs to add (order-preserving, deduped)
 */
export async function applyForumTags(forumChannel: ForumChannel, threadId: string, tagIds: string[]): Promise<void> {
  try {
    const incoming = tagIds.filter(id => id.length > 0);
    if (incoming.length === 0) {
      enhancedLogger.info('No valid tags to apply to forum post', LogCategory.SYSTEM, { threadId });
      return;
    }

    const thread = await forumChannel.threads.fetch(threadId);
    if (!thread) return;

    // Live thread tags first (manual additions survive), then new ones.
    const merged = [...(thread.appliedTags ?? [])];
    for (const id of incoming) {
      if (!merged.includes(id)) merged.push(id);
    }

    // Discord caps applied tags at 5 per thread — don't hide what fell off.
    const applied = merged.slice(0, 5);
    if (merged.length > applied.length) {
      enhancedLogger.warn('Forum post is at the 5-tag limit — some tags were not applied', LogCategory.SYSTEM, {
        threadId,
        dropped: merged.slice(5),
      });
    }

    await thread.setAppliedTags(applied);
    enhancedLogger.info(`Applied ${applied.length} tags to forum post`, LogCategory.SYSTEM, {
      threadId,
      tagCount: applied.length,
    });
  } catch (error) {
    enhancedLogger.error('Failed to apply forum tags to post', error as Error, LogCategory.ERROR, {
      threadId,
      tagIds,
    });
  }
}

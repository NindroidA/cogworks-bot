import type { ForumChannel, GuildForumTag, GuildForumTagData, GuildForumTagEmoji } from 'discord.js';
import { enhancedLogger, LogCategory } from './monitoring/enhancedLogger';
import { sleep } from './time';

/** Discord's per-forum cap on available tags. */
export const FORUM_TAG_LIMIT = 20;
/** Discord's cap on a forum tag name's length. */
export const FORUM_TAG_NAME_MAX = 20;

/**
 * The tag name used for `displayName`, within Discord's 20 characters. A
 * trailing " Application" (built-in position titles) goes first, so
 * "Developer Application" tags as "Developer".
 */
export function forumTagName(displayName: string): string {
  const name = displayName.trim();
  return (name.length > FORUM_TAG_NAME_MAX ? name.replace(/\s+application$/i, '') : name).slice(0, FORUM_TAG_NAME_MAX);
}

/** Convert a stored emoji string (unicode or `<:name:id>`) to a forum tag emoji. */
export function toForumTagEmoji(emoji: string | null | undefined): GuildForumTagEmoji | null {
  if (!emoji) return null;
  const custom = emoji.match(/<a?:(\w+):(\d+)>/);
  return custom ? { id: custom[2], name: custom[1] } : { id: null, name: emoji };
}

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
  // A name over 20 characters was rejected on every close.
  const tagName = forumTagName(displayName) || typeId.slice(0, FORUM_TAG_NAME_MAX);
  try {
    // Check if tag already exists (by name)
    const existingTag = forumChannel.availableTags.find(tag => tag.name.toLowerCase() === tagName.toLowerCase());

    if (existingTag) {
      enhancedLogger.info(`Forum tag "${displayName}" already exists`, LogCategory.SYSTEM, {
        tagId: existingTag.id,
        forumId: forumChannel.id,
      });
      return existingTag.id;
    }

    // Discord API limit: 20 tags per forum channel
    if (forumChannel.availableTags.length >= FORUM_TAG_LIMIT) {
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
      name: tagName,
      moderated: false,
    };
    const tagEmoji = toForumTagEmoji(emoji);
    if (tagEmoji) newTagData.emoji = tagEmoji;

    // Update forum channel with new tag
    const updatedTags = [...forumChannel.availableTags, newTagData as GuildForumTag];
    await forumChannel.setAvailableTags(updatedTags);

    // Wait a moment for Discord to process the change
    await sleep(500);

    // Fetch the created tag ID (it's the last one added)
    const refreshedChannel = (await forumChannel.fetch()) as ForumChannel;
    const createdTag = refreshedChannel.availableTags.find(tag => tag.name.toLowerCase() === tagName.toLowerCase());

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

export interface ForumTagSeed {
  name: string;
  emoji: string | null;
}

/**
 * Adds `seeds` to a forum's tag list WITHOUT removing anything (the "Forum Tag
 * System" rule in CLAUDE.md). `setAvailableTags` replaces the whole list, and
 * Discord deletes every omitted tag and strips it from every post, so this
 * always sends the forum's current tags (with their ids) first. A seed whose
 * name already exists (case-insensitive) reuses that tag; the rest are appended
 * until the 20-tag cap — seeds that don't fit are skipped and logged rather
 * than failing the whole PATCH.
 * @returns seed name → forum tag id (null when skipped), plus the skipped names
 */
export async function mergeForumTags(
  forum: ForumChannel,
  seeds: ForumTagSeed[],
): Promise<{ ids: Map<string, string | null>; skipped: string[] }> {
  const existing = forum.availableTags;
  const known = new Set(existing.map(t => t.name.toLowerCase()));
  const toAdd: GuildForumTagData[] = [];
  const skipped: string[] = [];

  for (const seed of seeds) {
    const key = seed.name.toLowerCase();
    if (known.has(key)) continue;
    if (existing.length + toAdd.length >= FORUM_TAG_LIMIT) {
      skipped.push(seed.name);
      continue;
    }
    known.add(key);
    toAdd.push({ name: seed.name, emoji: toForumTagEmoji(seed.emoji) });
  }

  const finalTags = toAdd.length > 0 ? (await forum.setAvailableTags([...existing, ...toAdd])).availableTags : existing;

  if (skipped.length > 0) {
    enhancedLogger.warn('Forum is at the 20-tag limit — some tags were not added', LogCategory.SYSTEM, {
      forumId: forum.id,
      skipped,
    });
  }

  const ids = new Map<string, string | null>();
  for (const seed of seeds) {
    ids.set(seed.name, finalTags.find(t => t.name.toLowerCase() === seed.name.toLowerCase())?.id ?? null);
  }
  return { ids, skipped };
}

/**
 * Applies forum tags to a forum post/thread, ACCUMULATING onto whatever tags
 * the thread already carries (the "Forum Tag System" rule in CLAUDE.md) —
 * `setAppliedTags` replaces, so passing only the caller's list used to wipe
 * any tag a moderator had added to the thread by hand.
 * @param forumChannel - The forum channel containing the thread
 * @param threadId - The thread/post ID to apply tags to
 * @param tagIds - Array of tag IDs to add (order-preserving, deduped)
 * @returns The tag ids actually applied to the thread, or null on failure /
 * no-op. Callers that persist tag state must check this — the 5-tag Discord
 * cap can drop an incoming tag, and persisting it anyway makes the DB claim
 * a tag the thread will never show.
 */
export async function applyForumTags(
  forumChannel: ForumChannel,
  threadId: string,
  tagIds: string[],
): Promise<string[] | null> {
  try {
    const incoming = tagIds.filter(id => id.length > 0);
    if (incoming.length === 0) {
      enhancedLogger.info('No valid tags to apply to forum post', LogCategory.SYSTEM, { threadId });
      return null;
    }

    const thread = await forumChannel.threads.fetch(threadId);
    if (!thread) return null;

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
    return applied;
  } catch (error) {
    enhancedLogger.error('Failed to apply forum tags to post', error as Error, LogCategory.ERROR, {
      threadId,
      tagIds,
    });
    return null;
  }
}

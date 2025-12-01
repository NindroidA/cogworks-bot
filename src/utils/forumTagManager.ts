import { ForumChannel, GuildForumTag } from 'discord.js';
import { enhancedLogger, LogCategory } from './monitoring/enhancedLogger';
import { logger } from './index';

/**
 * Creates or finds a forum tag based on custom ticket type properties
 * @param forumChannel - The forum channel to manage tags in
 * @param typeId - The custom ticket type ID (e.g., "ban_appeal", "bug_report")
 * @param displayName - The display name for the tag
 * @param emoji - Optional emoji for the tag
 * @returns The tag ID (snowflake string)
 */
export async function ensureForumTag(
    forumChannel: ForumChannel,
    typeId: string,
    displayName: string,
    emoji: string | null
): Promise<string> {
    try {
        // Check if tag already exists (by name)
        const existingTag = forumChannel.availableTags.find(
            tag => tag.name.toLowerCase() === displayName.toLowerCase()
        );

        if (existingTag) {
            enhancedLogger.info(
                `Forum tag "${displayName}" already exists`,
                LogCategory.SYSTEM,
                { tagId: existingTag.id, forumId: forumChannel.id }
            );
            return existingTag.id;
        }

        // Discord API limit: 20 tags per forum channel
        if (forumChannel.availableTags.length >= 20) {
            logger(`Warning: Forum ${forumChannel.name} has reached tag limit (20). Cannot create new tags.`, 'WARN');
            enhancedLogger.warn(
                `Forum channel has reached maximum tag limit (20), cannot create tag for ${displayName}`,
                LogCategory.SYSTEM,
                { forumId: forumChannel.id }
            );
            // Return empty string to indicate no tag could be created
            return '';
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
                    name: customEmojiMatch[1]
                };
            } else {
                // Unicode emoji
                newTagData.emoji = {
                    id: null,
                    name: emoji
                };
            }
        }

        // Update forum channel with new tag
        const updatedTags = [...forumChannel.availableTags, newTagData as GuildForumTag];
        await forumChannel.setAvailableTags(updatedTags);

        // Wait a moment for Discord to process the change
        await new Promise(resolve => setTimeout(resolve, 500));

        // Fetch the created tag ID (it's the last one added)
        const refreshedChannel = await forumChannel.fetch() as ForumChannel;
        const createdTag = refreshedChannel.availableTags.find(
            tag => tag.name.toLowerCase() === displayName.toLowerCase()
        );

        if (!createdTag) {
            enhancedLogger.error(
                `Tag "${displayName}" was created but could not be found after refresh`,
                new Error('Tag not found after creation'),
                LogCategory.ERROR,
                { forumId: forumChannel.id, displayName }
            );
            return '';
        }

        enhancedLogger.info(
            `Created forum tag "${displayName}"`,
            LogCategory.SYSTEM,
            { tagId: createdTag.id, forumId: forumChannel.id, emoji }
        );

        return createdTag.id;
    } catch (error) {
        enhancedLogger.error(
            `Failed to create/find forum tag for ${displayName}`,
            error as Error,
            LogCategory.ERROR,
            { forumId: forumChannel.id, typeId }
        );
        return '';
    }
}

/**
 * Applies forum tags to a forum post/thread
 * @param forumChannel - The forum channel containing the thread
 * @param threadId - The thread/post ID to apply tags to
 * @param tagIds - Array of tag IDs to apply
 */
export async function applyForumTags(
    forumChannel: ForumChannel,
    threadId: string,
    tagIds: string[]
): Promise<void> {
    try {
        // Filter out empty tag IDs and ensure we don't exceed 5 tags (Discord API limit)
        const validTagIds = tagIds.filter(id => id.length > 0).slice(0, 5);

        if (validTagIds.length === 0) {
            enhancedLogger.info(
                'No valid tags to apply to forum post',
                LogCategory.SYSTEM,
                { threadId }
            );
            return;
        }

        const thread = await forumChannel.threads.fetch(threadId);
        if (thread) {
            await thread.setAppliedTags(validTagIds);
            enhancedLogger.info(
                `Applied ${validTagIds.length} tags to forum post`,
                LogCategory.SYSTEM,
                { threadId, tagCount: validTagIds.length }
            );
        }
    } catch (error) {
        enhancedLogger.error(
            'Failed to apply forum tags to post',
            error as Error,
            LogCategory.ERROR,
            { threadId, tagIds }
        );
    }
}

/**
 * Channel Creator
 *
 * Creates channels and categories for system setup with proper permissions
 * and naming that matches the guild's existing format.
 *
 * Channel names and templates are defined in ./channelDefaults.ts — edit
 * that file to customize the names for auto-created channels.
 */

import {
  ChannelType,
  type Guild,
  type GuildBasedChannel,
  GuildFeature,
  OverwriteType,
  PermissionFlagsBits,
} from 'discord.js';
import { verifiedChannelDelete } from '../discord/verifiedDelete';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import { type ChannelTemplate, SYSTEM_CHANNELS, type SystemType } from './channelDefaults';
import { type ChannelFormat, formatCategoryName, formatChannelName } from './channelFormatDetector';

// Re-export types from channelDefaults so existing imports still work
export type { ChannelTemplate, SystemType } from './channelDefaults';

export interface CreateChannelOptions {
  /** Custom name override (if not provided, uses default template name) */
  name?: string;
  /** Custom emoji override */
  emoji?: string;
  /** Parent category ID (for non-category channels) */
  parentId?: string;
}

export interface CreatedChannels {
  [key: string]: string; // channelKey → channelId
}

/**
 * Create all channels needed for a system.
 *
 * @param guild - The Discord guild
 * @param system - Which system to create channels for
 * @param format - Detected channel naming format
 * @param overrides - Optional per-channel name/emoji overrides
 * @param staffRoleId - Optional staff role for permission overwrites
 * @returns Map of channel keys to their created channel IDs
 */
export async function createSystemChannels(
  guild: Guild,
  system: SystemType,
  format: ChannelFormat,
  overrides?: Record<string, CreateChannelOptions>,
  staffRoleId?: string,
): Promise<CreatedChannels> {
  const templates = SYSTEM_CHANNELS[system];
  if (!templates) throw new Error(`Unknown system: ${system}`);

  const created: CreatedChannels = {};
  let categoryId: string | undefined;

  // Get max position to place new channels at the BOTTOM of the server
  const maxPosition =
    guild.channels.cache.reduce((max, ch) => Math.max(max, 'rawPosition' in ch ? ch.rawPosition || 0 : 0), 0) + 1;

  const { ViewChannel, SendMessages, ManageChannels, ReadMessageHistory } = PermissionFlagsBits;
  // An unknown role id would fail the whole create, so only a role the guild still has gets the
  // allow, and never @everyone (whose id is the guild's)
  const staffAllow =
    staffRoleId && staffRoleId !== guild.id && guild.roles.cache.has(staffRoleId)
      ? [{ id: staffRoleId, type: OverwriteType.Role, allow: [ViewChannel] }]
      : [];
  // The bot keeps access too: without it, a bot that isn't Administrator is locked out of what it just created
  const botId = guild.members.me?.id ?? guild.client.user?.id;
  const botAllow = botId
    ? [{ id: botId, type: OverwriteType.Member, allow: [ViewChannel, SendMessages, ManageChannels] }]
    : [];
  // A panel channel is read-only for members. Discord refuses an overwrite for a permission
  // the bot doesn't hold, so only those it holds are denied.
  const panelDeny = [
    SendMessages,
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.CreatePublicThreads,
    PermissionFlagsBits.SendMessagesInThreads,
  ].filter(perm => guild.members.me?.permissions.has(perm));

  const buildPerms = (template: ChannelTemplate) => {
    if (template.staffOnly) {
      return [{ id: guild.id, type: OverwriteType.Role, deny: [ViewChannel] }, ...staffAllow, ...botAllow];
    }
    // A channel created under a staff-only category with no overwrites of its own
    // syncs to the category's @everyone deny, so members' channels get an explicit allow.
    if (template.memberAccess === 'post') {
      return [{ id: guild.id, type: OverwriteType.Role, allow: [ViewChannel, SendMessages] }];
    }
    if (template.memberAccess === 'view') {
      // The bot still posts the panel, so it gets back the Send that @everyone loses
      const allow = [ViewChannel, ReadMessageHistory];
      return [{ id: guild.id, type: OverwriteType.Role, allow, deny: panelDeny }, ...botAllow];
    }
    return [];
  };

  // Phase 1: Create ALL categories first (category, threadCategory, etc.)
  for (const [key, template] of Object.entries(templates)) {
    if (template.type !== ChannelType.GuildCategory) continue;

    const override = overrides?.[key];
    const name = override?.name || template.baseName;
    const emoji = override?.emoji || template.defaultEmoji;
    const formattedName = formatCategoryName(name, emoji, format);

    try {
      const category = await guild.channels.create({
        name: formattedName,
        type: ChannelType.GuildCategory,
        position: maxPosition,
        permissionOverwrites: buildPerms(template),
      });

      created[key] = category.id;
      // First 'category' key becomes the default parent for non-category channels
      if (key === 'category') categoryId = category.id;

      enhancedLogger.info(`Created category: ${formattedName}`, LogCategory.COMMAND_EXECUTION, {
        guildId: guild.id,
        channelId: category.id,
        system,
        key,
      });
    } catch (error) {
      enhancedLogger.error(
        `Failed to create category ${key} for ${system}`,
        error as Error,
        LogCategory.COMMAND_EXECUTION,
        { guildId: guild.id },
      );
    }
  }

  // Phase 2: Create non-category channels under the main category
  for (const [key, template] of Object.entries(templates)) {
    if (template.type === ChannelType.GuildCategory) continue;

    const override = overrides?.[key];
    const name = override?.name || template.baseName;
    const emoji = override?.emoji || template.defaultEmoji;
    const parentCategory = override?.parentId || categoryId;

    // For text/forum channels, use simple hyphen format (Discord forces lowercase + hyphens anyway)
    const formattedName = formatChannelName(name, emoji, format);

    // Announcement channels need a Community server; anywhere else a text channel does the job
    const type =
      template.type === ChannelType.GuildAnnouncement && !guild.features.includes(GuildFeature.Community)
        ? ChannelType.GuildText
        : template.type;

    try {
      const perms = buildPerms(template);
      const channel = await guild.channels.create({
        name: formattedName,
        type,
        parent: parentCategory,
        permissionOverwrites: perms.length > 0 ? perms : undefined,
      });

      created[key] = channel.id;

      enhancedLogger.info(`Created channel: ${formattedName}`, LogCategory.COMMAND_EXECUTION, {
        guildId: guild.id,
        channelId: channel.id,
        system,
        key,
      });
    } catch (error) {
      enhancedLogger.error(
        `Failed to create channel ${key} for ${system}`,
        error as Error,
        LogCategory.COMMAND_EXECUTION,
        { guildId: guild.id },
      );
    }
  }

  return created;
}

/**
 * Delete what a failed auto-create left behind, channels before their
 * categories (deleting a category first would leave its channels loose at
 * the top of the server). Returns the ids it couldn't delete.
 */
export async function deleteCreatedChannels(guild: Guild, created: CreatedChannels): Promise<string[]> {
  const channels = Object.values(created)
    .map(id => guild.channels.cache.get(id))
    .filter((channel): channel is GuildBasedChannel => channel !== undefined);
  const isCategory = (channel: GuildBasedChannel) => (channel.type === ChannelType.GuildCategory ? 1 : 0);
  channels.sort((a, b) => isCategory(a) - isCategory(b));
  const left: string[] = [];
  for (const channel of channels) {
    const result = await verifiedChannelDelete(channel, { guildId: guild.id, label: 'auto-created setup channel' });
    if (!result.success) left.push(channel.id);
  }
  return left;
}

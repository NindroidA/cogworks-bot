/**
 * Channel Creator
 *
 * Creates channels and categories for system setup with proper permissions
 * and naming that matches the guild's existing format.
 *
 * Channel names and templates are defined in ./channelDefaults.ts — edit
 * that file to customize the names for auto-created channels.
 */

import { ChannelType, type Guild, PermissionFlagsBits } from 'discord.js';
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

  // Helper: build staff-only permission overwrites
  const buildPerms = (staffOnly?: boolean) =>
    staffOnly
      ? [
          { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          ...(staffRoleId ? [{ id: staffRoleId, allow: [PermissionFlagsBits.ViewChannel] }] : []),
        ]
      : [];

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
        permissionOverwrites: buildPerms(template.staffOnly),
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

    try {
      const perms = buildPerms(template.staffOnly);
      const channel = await guild.channels.create({
        name: formattedName,
        type: template.type,
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
 * Get the default channel templates for a system.
 * Useful for showing the user what channels will be created.
 */
export function getSystemChannelTemplates(system: SystemType): Record<string, ChannelTemplate> {
  return SYSTEM_CHANNELS[system] || {};
}

/**
 * Check if the guild has room for more channels.
 * Discord limit: 500 channels per guild.
 */
export function hasChannelCapacity(guild: Guild, neededCount: number): boolean {
  return guild.channels.cache.size + neededCount <= 500;
}

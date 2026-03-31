/**
 * Permission Validation Utilities
 *
 * Centralized permission checking for all commands
 */

import {
  type GuildMember,
  type Interaction,
  PermissionFlagsBits,
  type PermissionResolvable,
  PermissionsBitField,
} from 'discord.js';
import { lang } from '../../lang';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';

export interface PermissionCheckResult {
  allowed: boolean;
  message?: string;
}

function hasAdminPermission(member: GuildMember | null): PermissionCheckResult {
  if (!member) {
    return {
      allowed: false,
      message: '❌ Could not verify your permissions.',
    };
  }

  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    message: '❌ This command requires **Administrator** permission.',
  };
}

export function hasPermission(
  member: GuildMember | null,
  permission: bigint,
  permissionName: string,
): PermissionCheckResult {
  if (!member) {
    return {
      allowed: false,
      message: '❌ Could not verify your permissions.',
    };
  }

  if (member.permissions.has(permission)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    message: `❌ This command requires **${permissionName}** permission.`,
  };
}

function requireGuild(interaction: Interaction): PermissionCheckResult {
  if (!interaction.guild || !interaction.guildId) {
    return {
      allowed: false,
      message: '❌ This command can only be used in a server.',
    };
  }

  return { allowed: true };
}

/**
 * Combined check for admin permission with logging
 */
export function requireAdmin(interaction: Interaction): PermissionCheckResult {
  const guildCheck = requireGuild(interaction);
  if (!guildCheck.allowed) {
    return guildCheck;
  }

  const member = interaction.member as GuildMember | null;
  const adminCheck = hasAdminPermission(member);

  if (!adminCheck.allowed) {
    const commandName = 'commandName' in interaction ? interaction.commandName : 'interaction';
    enhancedLogger.warn(
      `User ${interaction.user.tag} attempted to use admin command ${commandName} without permission`,
      LogCategory.SECURITY,
    );
  }

  return adminCheck;
}

/**
 * Check if user is the bot owner (via BOT_OWNER_ID env var)
 */
export function requireBotOwner(userId: string): PermissionCheckResult {
  const BOT_OWNER_ID = process.env.BOT_OWNER_ID;
  if (!BOT_OWNER_ID || userId !== BOT_OWNER_ID) {
    return { allowed: false, message: lang.status.ownerOnly };
  }
  return { allowed: true };
}

/**
 * Predefined permission sets for channel permission overwrites
 */
export const PermissionSets = {
  TICKET_CREATOR: [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.UseExternalEmojis,
  ] as PermissionResolvable[],

  STAFF_MEMBER: [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.UseExternalEmojis,
  ] as PermissionResolvable[],

  APPLICATION_CREATOR: [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.UseExternalEmojis,
    PermissionFlagsBits.EmbedLinks,
  ] as PermissionResolvable[],

  DENY_ALL: [PermissionFlagsBits.ViewChannel] as PermissionResolvable[],
} as const;

/**
 * Creates permission overwrites for a private channel
 */
export function createPrivateChannelPermissions(
  guildId: string,
  allowedUserIds: string[],
  allowedRoleIds: string[],
  permissions: PermissionResolvable[] = PermissionSets.STAFF_MEMBER,
): Array<{
  id: string;
  deny?: PermissionResolvable[];
  allow?: PermissionResolvable[];
}> {
  const overwrites: Array<{
    id: string;
    deny?: PermissionResolvable[];
    allow?: PermissionResolvable[];
  }> = [
    {
      id: guildId,
      deny: PermissionSets.DENY_ALL,
    },
  ];

  for (const userId of allowedUserIds) {
    overwrites.push({ id: userId, allow: permissions });
  }

  for (const roleId of allowedRoleIds) {
    overwrites.push({ id: roleId, allow: permissions });
  }

  return overwrites;
}

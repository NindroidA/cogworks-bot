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

export function hasAdminPermission(member: GuildMember | null): PermissionCheckResult {
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

export function hasAnyPermission(
  member: GuildMember | null,
  permissions: bigint[],
  permissionNames: string[],
): PermissionCheckResult {
  if (!member) {
    return {
      allowed: false,
      message: '❌ Could not verify your permissions.',
    };
  }

  for (const permission of permissions) {
    if (member.permissions.has(permission)) {
      return { allowed: true };
    }
  }

  const permList = permissionNames.join('** or **');
  return {
    allowed: false,
    message: `❌ This command requires **${permList}** permission.`,
  };
}

export function hasAllPermissions(
  member: GuildMember | null,
  permissions: bigint[],
  permissionNames: string[],
): PermissionCheckResult {
  if (!member) {
    return {
      allowed: false,
      message: '❌ Could not verify your permissions.',
    };
  }

  for (let i = 0; i < permissions.length; i++) {
    if (!member.permissions.has(permissions[i])) {
      return {
        allowed: false,
        message: `❌ This command requires **${permissionNames[i]}** permission.`,
      };
    }
  }

  return { allowed: true };
}

export function isGuildOwner(member: GuildMember | null): PermissionCheckResult {
  if (!member) {
    return {
      allowed: false,
      message: '❌ Could not verify your permissions.',
    };
  }

  if (member.guild.ownerId === member.id) {
    return { allowed: true };
  }

  return {
    allowed: false,
    message: '❌ This command can only be used by the **server owner**.',
  };
}

export function hasRole(member: GuildMember | null, roleId: string, roleName?: string): PermissionCheckResult {
  if (!member) {
    return {
      allowed: false,
      message: '❌ Could not verify your permissions.',
    };
  }

  if (member.roles.cache.has(roleId)) {
    return { allowed: true };
  }

  const roleDisplay = roleName || `<@&${roleId}>`;
  return {
    allowed: false,
    message: `❌ This command requires the ${roleDisplay} role.`,
  };
}

export function hasAnyRole(member: GuildMember | null, roleIds: string[], roleNames?: string[]): PermissionCheckResult {
  if (!member) {
    return {
      allowed: false,
      message: '❌ Could not verify your permissions.',
    };
  }

  for (const roleId of roleIds) {
    if (member.roles.cache.has(roleId)) {
      return { allowed: true };
    }
  }

  let roleDisplay: string;
  if (roleNames && roleNames.length > 0) {
    roleDisplay = roleNames.join(' or ');
  } else {
    roleDisplay = roleIds.map(id => `<@&${id}>`).join(' or ');
  }

  return {
    allowed: false,
    message: `❌ This command requires one of these roles: ${roleDisplay}`,
  };
}

export function isRoleAbove(member: GuildMember | null, targetRoleId: string): PermissionCheckResult {
  if (!member) {
    return {
      allowed: false,
      message: '❌ Could not verify your permissions.',
    };
  }

  const targetRole = member.guild.roles.cache.get(targetRoleId);
  if (!targetRole) {
    return {
      allowed: false,
      message: '❌ Target role not found.',
    };
  }

  const memberHighestRole = member.roles.highest;
  if (memberHighestRole.position > targetRole.position) {
    return { allowed: true };
  }

  return {
    allowed: false,
    message: `❌ Your highest role must be above ${targetRole.name} to perform this action.`,
  };
}

export function requireGuild(interaction: Interaction): PermissionCheckResult {
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
 *
 * @param interaction - Command interaction
 * @returns Permission check result with automatic logging
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
 * Combined check for guild owner with logging
 *
 * @param interaction - Command interaction
 * @returns Permission check result with automatic logging
 */
export function requireOwner(interaction: Interaction): PermissionCheckResult {
  const guildCheck = requireGuild(interaction);
  if (!guildCheck.allowed) {
    return guildCheck;
  }

  const member = interaction.member as GuildMember | null;
  const ownerCheck = isGuildOwner(member);

  if (!ownerCheck.allowed) {
    const commandName = 'commandName' in interaction ? interaction.commandName : 'interaction';
    enhancedLogger.warn(
      `User ${interaction.user.tag} attempted to use owner command ${commandName} without permission`,
      LogCategory.SECURITY,
    );
  }

  return ownerCheck;
}

/**
 * Check if user is the bot owner (via BOT_OWNER_ID env var)
 *
 * @param userId - Discord user ID to check
 * @returns Permission check result
 */
export function requireBotOwner(userId: string): PermissionCheckResult {
  const BOT_OWNER_ID = process.env.BOT_OWNER_ID;
  if (!BOT_OWNER_ID || userId !== BOT_OWNER_ID) {
    return { allowed: false, message: lang.status.ownerOnly };
  }
  return { allowed: true };
}

/**
 * Predefined permission sets for common validation use cases
 */
export const ValidationPermissionSets = {
  MANAGE_TICKETS: [PermissionsBitField.Flags.ManageMessages, PermissionsBitField.Flags.ManageChannels],
  MANAGE_APPLICATIONS: [PermissionsBitField.Flags.ManageRoles, PermissionsBitField.Flags.ManageMessages],
  MANAGE_ANNOUNCEMENTS: [PermissionsBitField.Flags.ManageMessages, PermissionsBitField.Flags.MentionEveryone],
  MODERATE: [PermissionsBitField.Flags.ModerateMembers, PermissionsBitField.Flags.KickMembers],
} as const;

/**
 * Predefined permission names for error messages
 */
export const PermissionNames = {
  ADMINISTRATOR: 'Administrator',
  MANAGE_GUILD: 'Manage Server',
  MANAGE_ROLES: 'Manage Roles',
  MANAGE_CHANNELS: 'Manage Channels',
  MANAGE_MESSAGES: 'Manage Messages',
  MODERATE_MEMBERS: 'Moderate Members',
  KICK_MEMBERS: 'Kick Members',
  BAN_MEMBERS: 'Ban Members',
  MENTION_EVERYONE: 'Mention Everyone',
} as const;

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

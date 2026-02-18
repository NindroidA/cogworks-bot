/**
 * Permission Validation Utilities
 *
 * Centralized permission checking for all commands
 */

import {
  type ChatInputCommandInteraction,
  type GuildMember,
  PermissionsBitField,
} from 'discord.js';
import { lang, logger } from '../index';

/**
 * Permission check result
 */
export interface PermissionCheckResult {
  allowed: boolean;
  message?: string;
}

/**
 * Check if user has administrator permission
 *
 * @param member - Guild member to check
 * @returns Permission check result
 */
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

/**
 * Check if user has specific permission
 *
 * @param member - Guild member to check
 * @param permission - Permission to check for
 * @param permissionName - Human-readable permission name for error message
 * @returns Permission check result
 */
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

/**
 * Check if user has any of the specified permissions
 *
 * @param member - Guild member to check
 * @param permissions - Array of permissions to check for
 * @param permissionNames - Human-readable permission names for error message
 * @returns Permission check result
 */
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

/**
 * Check if user has all of the specified permissions
 *
 * @param member - Guild member to check
 * @param permissions - Array of permissions to check for
 * @param permissionNames - Human-readable permission names for error message
 * @returns Permission check result
 */
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

/**
 * Check if user is guild owner
 *
 * @param member - Guild member to check
 * @returns Permission check result
 */
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

/**
 * Check if user has a specific role
 *
 * @param member - Guild member to check
 * @param roleId - Role ID to check for
 * @param roleName - Human-readable role name for error message
 * @returns Permission check result
 */
export function hasRole(
  member: GuildMember | null,
  roleId: string,
  roleName?: string,
): PermissionCheckResult {
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

/**
 * Check if user has any of the specified roles
 *
 * @param member - Guild member to check
 * @param roleIds - Array of role IDs to check for
 * @param roleNames - Human-readable role names for error message
 * @returns Permission check result
 */
export function hasAnyRole(
  member: GuildMember | null,
  roleIds: string[],
  roleNames?: string[],
): PermissionCheckResult {
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

/**
 * Check role hierarchy (is member's highest role above target role?)
 *
 * @param member - Guild member to check
 * @param targetRoleId - Role ID to compare against
 * @returns Permission check result
 */
export function isRoleAbove(
  member: GuildMember | null,
  targetRoleId: string,
): PermissionCheckResult {
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

/**
 * Validate interaction is in a guild
 *
 * @param interaction - Command interaction
 * @returns Permission check result
 */
export function requireGuild(interaction: ChatInputCommandInteraction): PermissionCheckResult {
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
export function requireAdmin(interaction: ChatInputCommandInteraction): PermissionCheckResult {
  const guildCheck = requireGuild(interaction);
  if (!guildCheck.allowed) {
    return guildCheck;
  }

  const member = interaction.member as GuildMember | null;
  const adminCheck = hasAdminPermission(member);

  if (!adminCheck.allowed) {
    logger(
      `User ${interaction.user.tag} attempted to use admin command ${interaction.commandName} without permission`,
      'WARN',
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
export function requireOwner(interaction: ChatInputCommandInteraction): PermissionCheckResult {
  const guildCheck = requireGuild(interaction);
  if (!guildCheck.allowed) {
    return guildCheck;
  }

  const member = interaction.member as GuildMember | null;
  const ownerCheck = isGuildOwner(member);

  if (!ownerCheck.allowed) {
    logger(
      `User ${interaction.user.tag} attempted to use owner command ${interaction.commandName} without permission`,
      'WARN',
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
  MANAGE_TICKETS: [
    PermissionsBitField.Flags.ManageMessages,
    PermissionsBitField.Flags.ManageChannels,
  ],
  MANAGE_APPLICATIONS: [
    PermissionsBitField.Flags.ManageRoles,
    PermissionsBitField.Flags.ManageMessages,
  ],
  MANAGE_ANNOUNCEMENTS: [
    PermissionsBitField.Flags.ManageMessages,
    PermissionsBitField.Flags.MentionEveryone,
  ],
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

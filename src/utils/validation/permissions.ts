/**
 * Permissions Module
 *
 * Provides reusable permission sets and utility functions for Discord permission management.
 * Includes predefined permission sets for common use cases and helper functions for
 * permission checks and channel configuration.
 */

import {
  type GuildMember,
  PermissionFlagsBits,
  type PermissionResolvable,
  PermissionsBitField,
} from 'discord.js';

// ============================================================================
// Permission Sets
// ============================================================================

/**
 * Predefined permission sets for common scenarios
 */
export const PermissionSets = {
  /**
   * Standard permissions for ticket/application creators
   */
  TICKET_CREATOR: [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.UseExternalEmojis,
  ] as PermissionResolvable[],

  /**
   * Standard permissions for staff members in tickets/applications
   */
  STAFF_MEMBER: [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.UseExternalEmojis,
  ] as PermissionResolvable[],

  /**
   * Standard permissions for application creators (includes embed links)
   */
  APPLICATION_CREATOR: [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.UseExternalEmojis,
    PermissionFlagsBits.EmbedLinks,
  ] as PermissionResolvable[],

  /**
   * Deny all channel access
   */
  DENY_ALL: [PermissionFlagsBits.ViewChannel] as PermissionResolvable[],
} as const;

// ============================================================================
// Permission Check Functions
// ============================================================================

/**
 * Checks if a member has specific permissions
 * @param member - The guild member to check
 * @param permissions - Array of permissions to check
 * @param requireAll - If true, member must have ALL permissions. If false, member needs at least ONE
 * @returns True if member has the required permissions
 * @example
 * // Check if member has all permissions
 * if (!hasPermissions(member, [PermissionFlagsBits.Administrator])) {
 *   return await interaction.reply({ content: 'Admin only', flags: [MessageFlags.Ephemeral] });
 * }
 */
export function hasPermissions(
  member: GuildMember,
  permissions: PermissionResolvable[],
  requireAll: boolean = true,
): boolean {
  if (requireAll) {
    return member.permissions.has(permissions);
  } else {
    return permissions.some(perm => member.permissions.has(perm));
  }
}

/**
 * Checks if a member is an administrator
 * @param member - The guild member to check
 * @returns True if member has administrator permission
 * @example
 * if (!isAdmin(interaction.member)) {
 *   return await interaction.reply({ content: 'Admin only', flags: [MessageFlags.Ephemeral] });
 * }
 */
export function isAdmin(member: GuildMember): boolean {
  return member.permissions.has(PermissionFlagsBits.Administrator);
}

/**
 * Checks if a member can manage channels
 * @param member - The guild member to check
 * @returns True if member has manage channels permission
 * @example
 * if (!canManageChannels(member)) {
 *   return await interaction.reply({ content: 'Missing permission', flags: [MessageFlags.Ephemeral] });
 * }
 */
export function canManageChannels(member: GuildMember): boolean {
  return member.permissions.has(PermissionFlagsBits.ManageChannels);
}

/**
 * Checks if a member can manage roles
 * @param member - The guild member to check
 * @returns True if member has manage roles permission
 * @example
 * if (!canManageRoles(member)) {
 *   return await interaction.reply({ content: 'Missing permission', flags: [MessageFlags.Ephemeral] });
 * }
 */
export function canManageRoles(member: GuildMember): boolean {
  return member.permissions.has(PermissionFlagsBits.ManageRoles);
}

// ============================================================================
// Channel Permission Functions
// ============================================================================

/**
 * Creates permission overwrites for a private channel
 * @param guildId - The guild ID (to deny @everyone)
 * @param allowedUserIds - Array of user IDs to allow
 * @param allowedRoleIds - Array of role IDs to allow
 * @param permissions - The permissions to grant (defaults to STAFF_MEMBER)
 * @returns Array of permission overwrites
 * @example
 * const overwrites = createPrivateChannelPermissions(
 *   guild.id,
 *   [userId],
 *   [staffRoleId],
 *   PermissionSets.TICKET_CREATOR
 * );
 * await guild.channels.create({
 *   name: 'private-channel',
 *   permissionOverwrites: overwrites
 * });
 */
export function createPrivateChannelPermissions(
  guildId: string,
  allowedUserIds: string[],
  allowedRoleIds: string[],
  permissions: PermissionResolvable[] = PermissionSets.STAFF_MEMBER,
): Array<{ id: string; deny?: PermissionResolvable[]; allow?: PermissionResolvable[] }> {
  const overwrites: Array<{
    id: string;
    deny?: PermissionResolvable[];
    allow?: PermissionResolvable[];
  }> = [
    // Deny @everyone
    {
      id: guildId,
      deny: PermissionSets.DENY_ALL,
    },
  ];

  // Add allowed users
  allowedUserIds.forEach(userId => {
    overwrites.push({
      id: userId,
      allow: permissions,
    });
  });

  // Add allowed roles
  allowedRoleIds.forEach(roleId => {
    overwrites.push({
      id: roleId,
      allow: permissions,
    });
  });

  return overwrites;
}

// ============================================================================
// Formatting Functions
// ============================================================================

/**
 * Formats permission bit field to human-readable string
 * @param permissions - PermissionsBitField or bigint
 * @returns Comma-separated list of permission names
 * @example
 * const perms = member.permissions;
 * const readable = formatPermissions(perms);
 * console.log(`Member has: ${readable}`);
 */
export function formatPermissions(permissions: PermissionsBitField | bigint): string {
  const permBitField =
    typeof permissions === 'bigint' ? new PermissionsBitField(permissions) : permissions;

  return permBitField.toArray().join(', ');
}

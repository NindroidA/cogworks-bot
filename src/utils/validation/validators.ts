/**
 * Validators Module
 *
 * Provides input validation utilities for Discord entities and data formats.
 * All validators return a consistent { valid, error? } pattern for easy error handling.
 */

import {
  type Channel,
  ChannelType,
  type Guild,
  type GuildMember,
  PermissionFlagsBits,
  PermissionsBitField,
  type Role,
} from 'discord.js';
import { lang } from '../../lang';

/**
 * Standard validation result format
 */
export interface ValidationResult {
  /** Whether the validation passed */
  valid: boolean;
  /** Error message if validation failed */
  error?: string;
}

/**
 * Validates a Discord channel with optional type checking
 * @param channel - The channel to validate
 * @param expectedType - Optional expected channel type
 * @returns Validation result with error message if invalid
 * @example
 * const result = validateChannel(channel, ChannelType.GuildText);
 * if (!result.valid) {
 *   return await interaction.reply({ content: result.error, flags: [MessageFlags.Ephemeral] });
 * }
 */
export function validateChannel(channel: Channel | null | undefined, expectedType?: ChannelType): ValidationResult {
  if (!channel) {
    return { valid: false, error: 'Channel not found.' };
  }

  if (expectedType !== undefined && channel.type !== expectedType) {
    const typeName = ChannelType[expectedType].replace('Guild', '');
    return { valid: false, error: `Channel must be a ${typeName} channel.` };
  }

  return { valid: true };
}

/**
 * Validates a Discord role
 * @param role - The role to validate
 * @returns Validation result with error message if invalid
 * @example
 * const result = validateRole(role);
 * if (!result.valid) {
 *   return await interaction.reply({ content: result.error, flags: [MessageFlags.Ephemeral] });
 * }
 */
export function validateRole(role: Role | null | undefined): ValidationResult {
  if (!role) {
    return { valid: false, error: 'Role not found.' };
  }

  return { valid: true };
}

/**
 * Validates a Discord guild member
 * @param member - The member to validate
 * @returns Validation result with error message if invalid
 * @example
 * const result = validateMember(member);
 * if (!result.valid) {
 *   return await interaction.reply({ content: result.error, flags: [MessageFlags.Ephemeral] });
 * }
 */
export function validateMember(member: GuildMember | null | undefined): ValidationResult {
  if (!member) {
    return { valid: false, error: 'Member not found.' };
  }

  return { valid: true };
}

/**
 * One RGI emoji (keycaps, flags, skin tones and ZWJ sequences included) or one
 * lone regional indicator letter, which Discord also takes as a reaction.
 */
// biome-ignore lint/complexity/useRegexLiterals: a `v`-flag literal needs an es2024 target (tsconfig is es2020)
const RGI_EMOJI = new RegExp('^[\\p{RGI_Emoji}\\p{Regional_Indicator}]$', 'v');

/**
 * Validates that a string is a valid emoji for Discord reactions.
 * Accepts standard Unicode emoji or custom Discord emoji format.
 * @param emoji - The emoji string to validate
 * @returns Validation result
 */
export function validateEmoji(emoji: string): ValidationResult {
  // Custom Discord emoji: <:name:id> or <a:name:id>
  if (/^<a?:\w{2,32}:\d{17,20}>$/.test(emoji)) {
    return { valid: true };
  }

  // One unicode emoji, including keycaps, flags, skin tones, ZWJ sequences and lone regional indicators
  if (RGI_EMOJI.test(emoji)) {
    return { valid: true };
  }

  return {
    valid: false,
    error: 'Invalid emoji. Use a standard emoji or custom Discord emoji (<:name:id>).',
  };
}

/** Role permissions only a server admin may have the bot hand out: each is moderation or admin power. */
const PRIVILEGED_ROLE_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageThreads,
  PermissionFlagsBits.ManageGuildExpressions,
  PermissionFlagsBits.MentionEveryone,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.MoveMembers,
  PermissionFlagsBits.MuteMembers,
  PermissionFlagsBits.DeafenMembers,
];

/** A role option as `getRole()` returns it (a cached Role or the raw API role). */
export interface AssignableRoleInput {
  id: string;
  managed: boolean;
  position: number;
  permissions: Readonly<PermissionsBitField> | string;
}

/** Whether a role carries moderation or admin permissions (only a server admin may hand those out). */
export function hasPrivilegedPermissions(role: Pick<AssignableRoleInput, 'permissions'>): boolean {
  const perms = typeof role.permissions === 'string' ? BigInt(role.permissions) : role.permissions;
  return new PermissionsBitField(perms).any(PRIVILEGED_ROLE_PERMISSIONS);
}

/**
 * Whether the invoker may set the bot up to grant this role (reaction roles,
 * XP rewards, the onboarding completion role). The bot grants with its own
 * Manage Roles, so Discord never checks the invoker: a feature manager could
 * otherwise hand themselves Administrator. Rejects @everyone, managed roles
 * and roles at or above the bot; for anyone but the owner, roles at or above
 * their own highest role (Discord's rule); and, unless they have Administrator,
 * roles with moderation or admin permissions.
 */
export async function validateAssignableRole(
  interaction: { guild: Guild; user: { id: string }; memberPermissions: Readonly<PermissionsBitField> | null },
  role: AssignableRoleInput,
): Promise<ValidationResult> {
  const { guild } = interaction;
  const tl = lang.errors.assignableRole;
  if (role.id === guild.id) return { valid: false, error: tl.everyone };
  if (role.managed) return { valid: false, error: tl.managed };

  const me = await guild.members.fetchMe();
  if (role.position >= me.roles.highest.position) return { valid: false, error: tl.aboveBot };
  if (interaction.user.id === guild.ownerId) return { valid: true };

  const invoker = await guild.members.fetch(interaction.user.id);
  if (role.position >= invoker.roles.highest.position) return { valid: false, error: tl.aboveInvoker };

  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
  if (!isAdmin && hasPrivilegedPermissions(role)) return { valid: false, error: tl.privileged };
  return { valid: true };
}

/**
 * Validates a string with optional length constraints
 * @param value - The string to validate
 * @param minLength - Optional minimum length
 * @param maxLength - Optional maximum length
 * @returns Validation result with error message if invalid
 * @example
 * const result = validateString(userInput, 1, 100);
 * if (!result.valid) {
 *   return await interaction.reply({ content: result.error, flags: [MessageFlags.Ephemeral] });
 * }
 */
export function validateString(
  value: string | null | undefined,
  minLength?: number,
  maxLength?: number,
): ValidationResult {
  if (!value || value.trim().length === 0) {
    return { valid: false, error: 'Value cannot be empty.' };
  }

  if (minLength !== undefined && value.length < minLength) {
    return {
      valid: false,
      error: `Value must be at least ${minLength} characters.`,
    };
  }

  if (maxLength !== undefined && value.length > maxLength) {
    return {
      valid: false,
      error: `Value must not exceed ${maxLength} characters.`,
    };
  }

  return { valid: true };
}

/**
 * Validates a Discord guild (server) ID
 * @param guild - The guild to validate
 * @returns Validation result with error message if invalid
 * @example
 * const result = validateGuildId(interaction.guild);
 * if (!result.valid) {
 *   return await interaction.reply({ content: result.error, flags: [MessageFlags.Ephemeral] });
 * }
 */
export function validateGuildId(guild: Guild | null | undefined): ValidationResult {
  if (!guild) {
    return {
      valid: false,
      error: 'This command can only be used in a server.',
    };
  }

  return { valid: true };
}

/**
 * Validates a date format string
 * @param dateString - Date string to validate
 * @param format - Expected format description (for error message)
 * @returns Validation result with error message if invalid
 * @example
 * const result = validateDateFormat(userInput, 'YYYY-MM-DD');
 * if (!result.valid) {
 *   return await interaction.reply({ content: result.error, flags: [MessageFlags.Ephemeral] });
 * }
 */
export function validateDateFormat(dateString: string, format: string = 'YYYY-MM-DD'): ValidationResult {
  const date = new Date(dateString);

  if (Number.isNaN(date.getTime())) {
    return { valid: false, error: `Invalid date format. Expected: ${format}` };
  }

  return { valid: true };
}

/**
 * Validators Module
 * 
 * Provides input validation utilities for Discord entities and data formats.
 * All validators return a consistent { valid, error? } pattern for easy error handling.
 */

import { Channel,
    ChannelType,
    Guild,
    GuildMember,
    Role, MessageFlags } from 'discord.js';

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * Standard validation result format
 */
export interface ValidationResult {
	/** Whether the validation passed */
	valid: boolean;
	/** Error message if validation failed */
	error?: string;
}

// ============================================================================
// Discord Entity Validators
// ============================================================================

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
export function validateChannel(
	channel: Channel | null | undefined, 
	expectedType?: ChannelType
): ValidationResult {
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

// ============================================================================
// String Validators
// ============================================================================

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
	maxLength?: number
): ValidationResult {
	if (!value || value.trim().length === 0) {
		return { valid: false, error: 'Value cannot be empty.' };
	}

	if (minLength !== undefined && value.length < minLength) {
		return { valid: false, error: `Value must be at least ${minLength} characters.` };
	}

	if (maxLength !== undefined && value.length > maxLength) {
		return { valid: false, error: `Value must not exceed ${maxLength} characters.` };
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
		return { valid: false, error: 'This command can only be used in a server.' };
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

	if (isNaN(date.getTime())) {
		return { valid: false, error: `Invalid date format. Expected: ${format}` };
	}

	return { valid: true };
}

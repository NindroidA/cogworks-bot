/**
 * Embed Builders Module
 * 
 * Provides consistent, reusable embed creation utilities for Discord messages.
 * Includes predefined color schemes and builder functions for common embed types.
 */

import { EmbedBuilder, MessageFlags } from 'discord.js';

// ============================================================================
// Color Constants
// ============================================================================

/**
 * Standardized embed colors for consistent UI across the bot
 */
export const EmbedColors = {
	/** Primary brand color (blue) */
	PRIMARY: '#5A97FA',
	/** Success messages (green) */
	SUCCESS: '#43B581',
	/** Error messages (red) */
	ERROR: '#F04747',
	/** Warning messages (orange) */
	WARNING: '#FAA61A',
	/** Informational messages (discord blurple) */
	INFO: '#5865F2',
} as const;

// ============================================================================
// Embed Builder Functions
// ============================================================================

/**
 * Creates a success embed with green color and checkmark
 * @param title - Embed title (checkmark auto-added)
 * @param description - Optional description content
 * @returns Configured EmbedBuilder instance
 * @example
 * const embed = createSuccessEmbed('User Verified', 'Welcome to the server!');
 * await interaction.reply({ embeds: [embed] });
 */
export function createSuccessEmbed(title: string, description?: string): EmbedBuilder {
	const embed = new EmbedBuilder()
		.setTitle(`✅ ${title}`)
		.setColor(EmbedColors.SUCCESS)
		.setTimestamp();

	if (description) {
		embed.setDescription(description);
	}

	return embed;
}

/**
 * Creates an error embed with red color and X mark
 * @param title - Embed title (X mark auto-added)
 * @param description - Optional error details
 * @returns Configured EmbedBuilder instance
 * @example
 * const embed = createErrorEmbed('Permission Denied', 'You need admin role');
 * await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
 */
export function createErrorEmbed(title: string, description?: string): EmbedBuilder {
	const embed = new EmbedBuilder()
		.setTitle(`❌ ${title}`)
		.setColor(EmbedColors.ERROR)
		.setTimestamp();

	if (description) {
		embed.setDescription(description);
	}

	return embed;
}

/**
 * Creates a warning embed with orange color and warning symbol
 * @param title - Embed title (warning symbol auto-added)
 * @param description - Optional warning details
 * @returns Configured EmbedBuilder instance
 * @example
 * const embed = createWarningEmbed('Slow Mode Active', 'Wait 10 seconds');
 * await channel.send({ embeds: [embed] });
 */
export function createWarningEmbed(title: string, description?: string): EmbedBuilder {
	const embed = new EmbedBuilder()
		.setTitle(`⚠️ ${title}`)
		.setColor(EmbedColors.WARNING)
		.setTimestamp();

	if (description) {
		embed.setDescription(description);
	}

	return embed;
}

/**
 * Creates an info embed with blue color
 * @param title - Embed title
 * @param description - Optional information content
 * @returns Configured EmbedBuilder instance
 * @example
 * const embed = createInfoEmbed('Maintenance Notice', 'Bot updates at 3 AM');
 * await channel.send({ embeds: [embed] });
 */
export function createInfoEmbed(title: string, description?: string): EmbedBuilder {
	const embed = new EmbedBuilder()
		.setTitle(title)
		.setColor(EmbedColors.INFO)
		.setTimestamp();

	if (description) {
		embed.setDescription(description);
	}

	return embed;
}

/**
 * Creates a custom embed with specified color
 * @param title - Embed title
 * @param description - Optional description content
 * @param color - Hex color string (defaults to PRIMARY)
 * @returns Configured EmbedBuilder instance
 * @example
 * const embed = createCustomEmbed('Event Alert', 'Starting soon!', '#9B59B6');
 * await channel.send({ embeds: [embed] });
 */
export function createCustomEmbed(title: string, description?: string, color: string = EmbedColors.PRIMARY): EmbedBuilder {
	const embed = new EmbedBuilder()
		.setTitle(title)
		.setColor(color as `#${string}`)
		.setTimestamp();

	if (description) {
		embed.setDescription(description);
	}

	return embed;
}


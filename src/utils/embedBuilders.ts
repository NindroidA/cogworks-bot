/**
 * Embed Builders Module
 *
 * Provides consistent, reusable embed creation utilities for Discord messages.
 * Uses centralized color system for consistent UI across the bot.
 */

import { type ColorResolvable, EmbedBuilder } from 'discord.js';
import { Colors } from './colors';

// ============================================================================
// Legacy Color Constants (for backwards compatibility)
// ============================================================================

/**
 * Standardized embed colors for consistent UI across the bot
 * @deprecated Use Colors from './colors' instead
 */
export const EmbedColors = {
  /** Primary brand color (blue) */
  PRIMARY: Colors.brand.primary,
  /** Success messages (green) */
  SUCCESS: Colors.status.success,
  /** Error messages (red) */
  ERROR: Colors.status.error,
  /** Warning messages (orange) */
  WARNING: Colors.status.warning,
  /** Informational messages (discord blurple) */
  INFO: Colors.status.info,
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
    .setTitle(`${title}`)
    .setColor(Colors.status.success)
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
    .setTitle(`${title}`)
    .setColor(Colors.status.error)
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
    .setTitle(`${title}`)
    .setColor(Colors.status.warning)
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
  const embed = new EmbedBuilder().setTitle(title).setColor(Colors.status.info).setTimestamp();

  if (description) {
    embed.setDescription(description);
  }

  return embed;
}

/**
 * Creates a custom embed with specified color
 * @param title - Embed title
 * @param description - Optional description content
 * @param color - ColorResolvable (defaults to brand primary)
 * @returns Configured EmbedBuilder instance
 * @example
 * const embed = createCustomEmbed('Event Alert', 'Starting soon!', Colors.brand.accent);
 * await channel.send({ embeds: [embed] });
 */
export function createCustomEmbed(
  title: string,
  description?: string,
  color: ColorResolvable = Colors.brand.primary,
): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(title).setColor(color).setTimestamp();

  if (description) {
    embed.setDescription(description);
  }

  return embed;
}

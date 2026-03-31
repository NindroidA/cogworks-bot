import { type ChatInputCommandInteraction, type Client, MessageFlags } from 'discord.js';
import { handleInteractionError, requireAdmin } from '../../../utils';
import { xpAdminHandler } from './admin';
import { leaderboardHandler } from './leaderboard';
import { rankHandler } from './rank';
import { xpSetupHandler } from './setup';

/**
 * /xp-setup handler — admin only, routes to setup subcommands
 */
export async function xpSetupCommandHandler(client: Client, interaction: ChatInputCommandInteraction) {
  try {
    const adminCheck = requireAdmin(interaction);
    if (!adminCheck.allowed) {
      await interaction.reply({
        content: adminCheck.message,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    if (!interaction.guildId) return;

    await xpSetupHandler(client, interaction);
  } catch (error) {
    await handleInteractionError(interaction, error, 'Failed to execute XP setup command');
  }
}

/**
 * /xp handler — admin only, routes to admin subcommands (set/reset/reset-all)
 */
export async function xpAdminCommandHandler(client: Client, interaction: ChatInputCommandInteraction) {
  try {
    const adminCheck = requireAdmin(interaction);
    if (!adminCheck.allowed) {
      await interaction.reply({
        content: adminCheck.message,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    if (!interaction.guildId) return;

    await xpAdminHandler(client, interaction);
  } catch (error) {
    await handleInteractionError(interaction, error, 'Failed to execute XP admin command');
  }
}

/**
 * /rank handler — any user can use
 */
export async function rankCommandHandler(client: Client, interaction: ChatInputCommandInteraction) {
  try {
    if (!interaction.guildId) return;
    await rankHandler(client, interaction);
  } catch (error) {
    await handleInteractionError(interaction, error, 'Failed to execute rank command');
  }
}

/**
 * /leaderboard handler — any user can use
 */
export async function leaderboardCommandHandler(client: Client, interaction: ChatInputCommandInteraction) {
  try {
    if (!interaction.guildId) return;
    await leaderboardHandler(client, interaction);
  } catch (error) {
    await handleInteractionError(interaction, error, 'Failed to execute leaderboard command');
  }
}

// Re-export config cache utilities for event handlers
export {
  clearXPConfigCache,
  getXPConfig,
  invalidateXPConfigCache,
} from './setup';

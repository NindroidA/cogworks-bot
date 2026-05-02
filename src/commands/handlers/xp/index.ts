import type { ChatInputCommandInteraction, Client } from 'discord.js';
import { guardFeatureAccess, handleInteractionError } from '../../../utils';
import { xpAdminHandler } from './admin';
import { leaderboardHandler } from './leaderboard';
import { rankHandler } from './rank';
import { xpSetupHandler } from './setup';

/**
 * /xp-setup handler — feature-gated (manage), routes to setup subcommands
 */
export async function xpSetupCommandHandler(client: Client, interaction: ChatInputCommandInteraction) {
  try {
    const guard = await guardFeatureAccess(interaction, 'xp', 'manage');
    if (!guard.allowed) return;

    if (!interaction.guildId) return;

    await xpSetupHandler(client, interaction);
  } catch (error) {
    await handleInteractionError(interaction, error, 'Failed to execute XP setup command');
  }
}

/**
 * /xp handler — feature-gated (admin) because the `reset-all` subcommand is
 * GDPR-scoped (wipes all guild XP). Per-subcommand granularity (e.g. `set`
 * at manage, `reset-all` at admin) would require moving the guard into
 * each handler — out of scope for this migration commit.
 */
export async function xpAdminCommandHandler(client: Client, interaction: ChatInputCommandInteraction) {
  try {
    const guard = await guardFeatureAccess(interaction, 'xp', 'admin');
    if (!guard.allowed) return;

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

// Config cache utilities now live in utils/xp/configCache; import directly
// from there. Re-exports kept temporarily would just be indirection.

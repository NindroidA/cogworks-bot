/**
 * Dev Suite Command Router
 *
 * Routes /dev-suite subcommands to their handlers.
 * Bot owner only, dev mode only.
 */

import type { ChatInputCommandInteraction, Client } from 'discord.js';
import { MessageFlags } from 'discord.js';
import { enhancedLogger, LogCategory, requireBotOwner } from '../../../utils';
import { handleScaffold, handleScaffoldAll, handleTeardown, handleTeardownAll } from './devSuiteScaffold';
import { handleMasterTest, handlePermissionsAudit, handleRegression, handleSmokeTest } from './devSuiteTests';
import { handleChain, handlePopulate, handleTimeline, handleWalkthrough } from './devSuiteWorkflows';

export async function devSuiteHandler(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
  // Bot owner only
  const ownerCheck = requireBotOwner(interaction.user.id);
  if (!ownerCheck.allowed) {
    await interaction.reply({
      content: ownerCheck.message || '❌ Bot owner only.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({
      content: '❌ Must be used in a server.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  try {
    switch (subcommand) {
      // Scaffold / Teardown
      case 'scaffold':
        await handleScaffold(client, interaction, guildId);
        break;
      case 'teardown':
        await handleTeardown(client, interaction, guildId);
        break;
      case 'scaffold-all':
        await handleScaffoldAll(client, interaction, guildId);
        break;
      case 'teardown-all':
        await handleTeardownAll(client, interaction, guildId);
        break;

      // Automated Testing
      case 'smoke-test':
        await handleSmokeTest(client, interaction, guildId);
        break;
      case 'regression':
        await handleRegression(client, interaction, guildId);
        break;
      case 'permissions-audit':
        await handlePermissionsAudit(client, interaction, guildId);
        break;
      case 'master-test':
        await handleMasterTest(client, interaction, guildId);
        break;

      // Data & Simulation
      case 'populate':
        await handlePopulate(client, interaction, guildId);
        break;
      case 'timeline':
        await handleTimeline(client, interaction, guildId);
        break;

      // Guided & Integration
      case 'walkthrough':
        await handleWalkthrough(client, interaction, guildId);
        break;
      case 'chain':
        await handleChain(client, interaction, guildId);
        break;

      default:
        await interaction.reply({
          content: '❌ Unknown dev-suite subcommand.',
          flags: [MessageFlags.Ephemeral],
        });
    }
  } catch (error) {
    enhancedLogger.error('Dev suite command error', error as Error, LogCategory.COMMAND_EXECUTION);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(`❌ Error: ${(error as Error).message}`).catch(() => {});
    } else {
      await interaction
        .reply({
          content: `❌ Error: ${(error as Error).message}`,
          flags: [MessageFlags.Ephemeral],
        })
        .catch(() => {});
    }
  }
}

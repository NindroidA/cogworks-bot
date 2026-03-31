/**
 * Insights Handler Router
 * Routes to the appropriate subcommand handler based on the subcommand name.
 */

import { type CacheType, type ChatInputCommandInteraction, type Client, MessageFlags } from 'discord.js';
import { requireAdmin } from '../../../utils';
import { channelsHandler } from './channels';
import { growthHandler } from './growth';
import { hoursHandler } from './hours';
import { overviewHandler } from './overview';
import { insightsSetupHandler } from './setup';

export async function insightsHandler(client: Client, interaction: ChatInputCommandInteraction<CacheType>) {
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({
      content: adminCheck.message,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'overview':
      await overviewHandler(client, interaction);
      break;
    case 'growth':
      await growthHandler(client, interaction);
      break;
    case 'channels':
      await channelsHandler(client, interaction);
      break;
    case 'hours':
      await hoursHandler(client, interaction);
      break;
    case 'setup':
      await insightsSetupHandler(client, interaction);
      break;
  }
}

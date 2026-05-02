/**
 * Insights Handler Router
 * Routes to the appropriate subcommand handler based on the subcommand name.
 */

import type { CacheType, ChatInputCommandInteraction, Client } from 'discord.js';
import { guardFeatureAccess } from '../../../utils';
import { channelsHandler } from './channels';
import { growthHandler } from './growth';
import { hoursHandler } from './hours';
import { overviewHandler } from './overview';
import { insightsSetupHandler } from './setup';

export async function insightsHandler(client: Client, interaction: ChatInputCommandInteraction<CacheType>) {
  // Dispatcher uses 'use' — read-only subcommands (overview/growth/channels/hours)
  // pass through. The setup subcommand's own guard escalates to 'manage'.
  const guard = await guardFeatureAccess(interaction, 'analytics', 'use');
  if (!guard.allowed) return;

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

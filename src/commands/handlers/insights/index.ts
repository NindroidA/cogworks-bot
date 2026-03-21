/**
 * Insights Handler Router
 * Routes to the appropriate subcommand handler based on the subcommand name.
 */

import type { CacheType, ChatInputCommandInteraction, Client } from 'discord.js';
import { channelsHandler } from './channels';
import { growthHandler } from './growth';
import { hoursHandler } from './hours';
import { overviewHandler } from './overview';
import { insightsSetupHandler } from './setup';

export const insightsHandler = async (
  client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
) => {
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
};

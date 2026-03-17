import type { CacheType, ChatInputCommandInteraction, Client } from 'discord.js';
import type { ExtendedClient } from '../../../types/ExtendedClient';
import { statusClearHandler } from './clear';
import { statusSetHandler } from './set';
import { statusViewHandler } from './view';

export const statusHandler = async (
  client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
) => {
  const statusManager = (client as ExtendedClient).statusManager;
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'set':
      await statusSetHandler(interaction, statusManager);
      break;
    case 'clear':
      await statusClearHandler(interaction, statusManager);
      break;
    case 'view':
      await statusViewHandler(interaction, statusManager);
      break;
  }
};

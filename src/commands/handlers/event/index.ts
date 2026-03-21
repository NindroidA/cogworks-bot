/**
 * Event Handler Router
 * Routes to event create, template CRUD, setup, remind, cancel, recurring,
 * or from-template based on subcommand group and subcommand.
 */

import type { CacheType, ChatInputCommandInteraction, Client } from 'discord.js';
import {
  handleEventCancel,
  handleEventCreate,
  handleFromTemplate,
  handleRecurring,
} from './create';
import { handleRemind } from './remind';
import { eventSetupHandler } from './setup';
import { eventTemplateHandler } from './template';

export const eventHandler = async (
  client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
) => {
  const subcommandGroup = interaction.options.getSubcommandGroup(false);
  const subcommand = interaction.options.getSubcommand();

  if (subcommandGroup === 'template') {
    await eventTemplateHandler(client, interaction);
    return;
  }

  if (subcommandGroup === 'setup') {
    await eventSetupHandler(client, interaction);
    return;
  }

  // Top-level subcommands
  switch (subcommand) {
    case 'create':
      await handleEventCreate(client, interaction);
      break;
    case 'from-template':
      await handleFromTemplate(client, interaction);
      break;
    case 'cancel':
      await handleEventCancel(client, interaction);
      break;
    case 'remind':
      await handleRemind(client, interaction);
      break;
    case 'recurring':
      await handleRecurring(client, interaction);
      break;
  }
};

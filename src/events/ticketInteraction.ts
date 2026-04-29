import type { Client, Interaction } from 'discord.js';
import { dispatchTicketInteraction } from './ticket/interactionRoutes';

export const handleTicketInteraction = async (client: Client, interaction: Interaction): Promise<boolean> => {
  if (!interaction.guildId) return false;
  return dispatchTicketInteraction(client, interaction);
};

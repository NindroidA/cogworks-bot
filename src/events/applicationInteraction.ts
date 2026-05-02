import type { Client, Interaction } from 'discord.js';
import { dispatchApplicationInteraction } from './application/interactionRoutes';

export const handleApplicationInteraction = async (client: Client, interaction: Interaction): Promise<boolean> => {
  if (!interaction.guildId) return false;
  return dispatchApplicationInteraction(client, interaction);
};

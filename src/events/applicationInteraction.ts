import type { Client, Interaction } from 'discord.js';
import { dispatchApplicationInteraction } from './application/interactionRoutes';

export const handleApplicationInteraction = async (client: Client, interaction: Interaction) => {
  if (!interaction.guildId) return;
  await dispatchApplicationInteraction(client, interaction);
};

import type { Client, Interaction } from 'discord.js';
import { dispatchTicketInteraction } from './ticket/interactionRoutes';

export const handleTicketInteraction = async (client: Client, interaction: Interaction) => {
  if (!interaction.guildId) return;
  await dispatchTicketInteraction(client, interaction);
};

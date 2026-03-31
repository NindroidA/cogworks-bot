/**
 * Announcement Handler Router
 * Routes to template CRUD or send handler based on subcommand group.
 */

import type { CacheType, ChatInputCommandInteraction, Client } from 'discord.js';
import { announcementHandler as sendHandler } from './handler';
import { templateHandler } from './templates';

export async function announcementHandler(client: Client, interaction: ChatInputCommandInteraction<CacheType>) {
  const subcommandGroup = interaction.options.getSubcommandGroup(false);

  if (subcommandGroup === 'template') {
    await templateHandler(client, interaction);
    return;
  }

  // send subcommand and legacy subcommands
  await sendHandler(client, interaction);
}

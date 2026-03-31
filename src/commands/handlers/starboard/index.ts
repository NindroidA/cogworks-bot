import type { CacheType, ChatInputCommandInteraction, Client } from 'discord.js';
import { starboardIgnoreHandler, starboardUnignoreHandler } from './ignore';
import { starboardRandomHandler } from './random';
import { starboardConfigHandler, starboardSetupHandler, starboardToggleHandler } from './setup';
import { starboardStatsHandler } from './stats';

export async function starboardHandler(_client: Client, interaction: ChatInputCommandInteraction<CacheType>) {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'setup':
      await starboardSetupHandler(interaction);
      break;
    case 'config':
      await starboardConfigHandler(interaction);
      break;
    case 'toggle':
      await starboardToggleHandler(interaction);
      break;
    case 'ignore':
      await starboardIgnoreHandler(interaction);
      break;
    case 'unignore':
      await starboardUnignoreHandler(interaction);
      break;
    case 'stats':
      await starboardStatsHandler(interaction);
      break;
    case 'random':
      await starboardRandomHandler(interaction);
      break;
  }
}

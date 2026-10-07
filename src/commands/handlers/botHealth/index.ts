/**
 * `/bot-health` router. Runs without a BotConfig (see the dispatcher's
 * NO_CONFIG_ROUTES), so every subcommand guards access itself.
 */
import type { CacheType, ChatInputCommandInteraction, Client } from 'discord.js';
import { botHealthCheckHandler } from './check';
import { botHealthRepairHandler } from './repair';

type SubcommandHandler = (client: Client, interaction: ChatInputCommandInteraction<CacheType>) => Promise<void>;

const SUBCOMMANDS: Record<string, SubcommandHandler> = {
  check: botHealthCheckHandler,
  repair: botHealthRepairHandler,
};

export async function botHealthHandler(client: Client, interaction: ChatInputCommandInteraction<CacheType>) {
  const handler = SUBCOMMANDS[interaction.options.getSubcommand()];
  if (handler) await handler(client, interaction);
}

/**
 * Bot Setup Command Handler
 *
 * This file exports the new modular bot setup wizard
 */

import type { CacheType, ChatInputCommandInteraction, Client } from 'discord.js';
import { botSetupHandler as setupWizard } from './botSetup/index';

/**
 * Main bot setup handler - delegates to the new modular wizard
 */
export async function botSetupHandler(
  client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
): Promise<void> {
  await setupWizard(client, interaction);
}

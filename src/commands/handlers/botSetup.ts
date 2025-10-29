import { MessageFlags } from 'discord.js';
/**
 * Bot Setup Command Handler
 * 
 * This file exports the new modular bot setup wizard
 */

import type { CacheType, ChatInputCommandInteraction, Client } from 'discord.js';
import { lang, logger } from '../../utils';
import { botSetupHandler as setupWizard } from './botSetup/index';

const tlC = lang.botConfig;

/**
 * Legacy handler for when bot config is not found
 * @deprecated This is no longer needed with the new setup wizard
 */
export const botSetupNotFound = async(client: Client, interaction: ChatInputCommandInteraction<CacheType>) => {
    logger(tlC.notFound, 'WARN');
    return await interaction.reply({
        content: tlC.notFound,
        flags: [MessageFlags.Ephemeral]
    });
};

/**
 * Main bot setup handler - delegates to the new modular wizard
 */
export const botSetupHandler = async(client: Client, interaction: ChatInputCommandInteraction<CacheType>): Promise<void> => {
    await setupWizard(client, interaction);
};
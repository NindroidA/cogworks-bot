/**
 * Import Command Handler — Routes subcommands
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { guardAdmin, handleInteractionError, lang, replyEphemeralError } from '../../../utils';
import { csvImportHandler } from './csv';
import { mee6ImportHandler } from './mee6';
import { importStatusHandler } from './status';

export async function importHandler(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    const guard = await guardAdmin(interaction);
    if (!guard.allowed) return;

    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'mee6':
        await mee6ImportHandler(interaction);
        break;
      case 'csv':
        await csvImportHandler(interaction);
        break;
      case 'status':
      case 'history':
      case 'cancel':
        await importStatusHandler(interaction, subcommand);
        break;
      default:
        await replyEphemeralError(interaction, lang.errors.unknownSubcommand);
    }
  } catch (error) {
    // handleInteractionError logs AND replies — the extra enhancedLogger.error
    // here double-logged every failure.
    await handleInteractionError(interaction, error as Error, 'Import command failed');
  }
}

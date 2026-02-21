import type { AutocompleteInteraction, Client } from 'discord.js';
import { applicationPositionAutocomplete } from '../commands/handlers/application/applicationPosition';
import { reactionRoleMenuAutocomplete } from '../commands/handlers/reactionRole';
import {
  ticketTypeAutocomplete,
  ticketTypeAutocompleteWithLegacy,
} from '../commands/handlers/ticket/typeToggle';
import { enhancedLogger, LogCategory } from '../utils';

/**
 * Handles autocomplete interactions for all commands
 */
export const handleAutocomplete = async (_client: Client, interaction: AutocompleteInteraction) => {
  const commandName = interaction.commandName;
  const guildId = interaction.guildId || '';

  try {
    // Route to appropriate autocomplete handler
    switch (commandName) {
      case 'ticket': {
        // All ticket subcommands that use type autocomplete
        const subcommand = interaction.options.getSubcommand();
        enhancedLogger.debug(
          `Autocomplete: /${commandName} ${subcommand}`,
          LogCategory.COMMAND_EXECUTION,
          { userId: interaction.user.id, guildId, subcommand },
        );

        if (
          subcommand === 'type-edit' ||
          subcommand === 'type-toggle' ||
          subcommand === 'type-default' ||
          subcommand === 'type-remove' ||
          subcommand === 'type-fields' ||
          subcommand === 'user-restrict'
        ) {
          await ticketTypeAutocomplete(interaction);
        } else if (subcommand === 'settings') {
          // Settings needs both legacy and custom types for ping-on-create
          await ticketTypeAutocompleteWithLegacy(interaction);
        }
        break;
      }
      case 'application': {
        const subcommand = interaction.options.getSubcommand();
        enhancedLogger.debug(
          `Autocomplete: /${commandName} position ${subcommand}`,
          LogCategory.COMMAND_EXECUTION,
          { userId: interaction.user.id, guildId, subcommand },
        );

        if (
          subcommand === 'remove' ||
          subcommand === 'toggle' ||
          subcommand === 'edit' ||
          subcommand === 'fields'
        ) {
          await applicationPositionAutocomplete(interaction);
        }
        break;
      }
      case 'reactionrole': {
        await reactionRoleMenuAutocomplete(interaction);
        break;
      }
    }
  } catch (error) {
    enhancedLogger.error(
      'Autocomplete error',
      error instanceof Error ? error : new Error(String(error)),
      LogCategory.COMMAND_EXECUTION,
      { userId: interaction.user.id, guildId, commandName },
    );
    // Fail silently for autocomplete
    try {
      await interaction.respond([]);
    } catch {
      // Already responded or interaction expired
    }
  }
};

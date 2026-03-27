import type { AutocompleteInteraction, Client } from 'discord.js';
import { templateAutocomplete } from '../commands/handlers/announcement/templates';
import { applicationPositionAutocomplete } from '../commands/handlers/application/applicationPosition';
import {
  applicationRemovableStatusAutocomplete,
  applicationWorkflowStatusAutocomplete,
} from '../commands/handlers/application/workflow';
import { handleKeywordAutocomplete } from '../commands/handlers/baitChannel/keywords';
import { memoryAutocomplete } from '../commands/handlers/memory';
import { memoryTagAutocomplete } from '../commands/handlers/memory/manageTags';
import { reactionRoleMenuAutocomplete } from '../commands/handlers/reactionRole';
import { routingRuleAutocomplete } from '../commands/handlers/ticket/routing';
import { ticketTypeAutocomplete, ticketTypeAutocompleteWithLegacy } from '../commands/handlers/ticket/typeToggle';
import { removableStatusAutocomplete, workflowStatusAutocomplete } from '../commands/handlers/ticket/workflow';
import { enhancedLogger, LogCategory } from '../utils';

/**
 * Handles autocomplete interactions for all commands
 */
export const handleAutocomplete = async (_client: Client, interaction: AutocompleteInteraction) => {
  const commandName = interaction.commandName;
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;

  try {
    // Route to appropriate autocomplete handler
    switch (commandName) {
      case 'ticket': {
        const group = interaction.options.getSubcommandGroup(false);
        const subcommand = interaction.options.getSubcommand();
        enhancedLogger.debug(`Autocomplete: /${commandName} ${group} ${subcommand}`, LogCategory.COMMAND_EXECUTION, {
          userId: interaction.user.id,
          guildId,
          subcommandGroup: group,
          subcommand,
        });

        if (group === 'type') {
          // Type group: edit, toggle, default, remove, fields all use type autocomplete
          if (subcommand !== 'add' && subcommand !== 'list') {
            await ticketTypeAutocomplete(interaction);
          }
        } else if (group === 'manage') {
          if (subcommand === 'status') {
            await workflowStatusAutocomplete(interaction);
          } else if (subcommand === 'user-restrict') {
            await ticketTypeAutocomplete(interaction);
          } else if (subcommand === 'settings') {
            await ticketTypeAutocompleteWithLegacy(interaction);
          }
        } else if (group === 'workflow') {
          if (subcommand === 'remove-status') {
            await removableStatusAutocomplete(interaction);
          } else if (subcommand === 'autoclose-enable') {
            await workflowStatusAutocomplete(interaction);
          }
        } else if (group === 'sla') {
          if (subcommand === 'per-type') {
            await ticketTypeAutocomplete(interaction);
          }
        } else if (group === 'routing') {
          if (subcommand === 'rule-add') {
            await ticketTypeAutocomplete(interaction);
          } else if (subcommand === 'rule-remove') {
            await routingRuleAutocomplete(interaction);
          }
        }
        break;
      }
      case 'application': {
        const subcommand = interaction.options.getSubcommand();
        enhancedLogger.debug(`Autocomplete: /${commandName} ${subcommand}`, LogCategory.COMMAND_EXECUTION, {
          userId: interaction.user.id,
          guildId,
          subcommand,
        });

        if (subcommand === 'remove' || subcommand === 'toggle' || subcommand === 'edit' || subcommand === 'fields') {
          await applicationPositionAutocomplete(interaction);
        } else if (subcommand === 'status') {
          await applicationWorkflowStatusAutocomplete(interaction);
        } else if (subcommand === 'workflow-remove-status') {
          await applicationRemovableStatusAutocomplete(interaction);
        }
        break;
      }
      case 'memory': {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'update-status' || subcommand === 'update-tags') {
          await memoryAutocomplete(interaction);
        }
        break;
      }
      case 'memory-setup': {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'tag-remove' || subcommand === 'tag-edit') {
          await memoryTagAutocomplete(interaction);
        }
        break;
      }
      case 'reactionrole': {
        await reactionRoleMenuAutocomplete(interaction);
        break;
      }
      case 'baitchannel': {
        const subcommand = interaction.options.getSubcommand();
        const group = interaction.options.getSubcommandGroup();
        if (group === 'detection' && subcommand === 'keywords') {
          await handleKeywordAutocomplete(interaction);
        }
        break;
      }
      case 'announcement': {
        await templateAutocomplete(interaction, choices => interaction.respond(choices));
        break;
      }
    }
  } catch (error) {
    enhancedLogger.error(
      'Autocomplete error',
      error instanceof Error ? error : new Error(String(error)),
      LogCategory.COMMAND_EXECUTION,
      {
        userId: interaction.user.id,
        guildId,
        commandName,
      },
    );
    // Fail silently for autocomplete
    try {
      await interaction.respond([]);
    } catch {
      // Already responded or interaction expired
    }
  }
};

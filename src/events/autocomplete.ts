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
import { ticketTypeAutocomplete, ticketTypeAutocompleteWithBuiltin } from '../commands/handlers/ticket/typeToggle';
import { removableStatusAutocomplete, workflowStatusAutocomplete } from '../commands/handlers/ticket/workflow';
import { enhancedLogger, LogCategory } from '../utils';

type AutocompleteHandler = (interaction: AutocompleteInteraction) => Promise<void>;

/**
 * Per-(command, group, subcommand) autocomplete dispatch table.
 *
 * Key shape: `command/group/subcommand` — empty `group` becomes `command//subcommand`.
 * Adding a new autocomplete-using subcommand means adding one row here, not
 * patching a switch. For commands that handle every subcommand the same way
 * (e.g. `reactionrole`, `announcement`), see `COMMAND_AUTOCOMPLETE_ROUTES`.
 */
const AUTOCOMPLETE_ROUTES: Record<string, AutocompleteHandler> = {
  // /ticket type * — every subcommand except add/list takes a ticket type
  'ticket/type/edit': ticketTypeAutocomplete,
  'ticket/type/toggle': ticketTypeAutocomplete,
  'ticket/type/default': ticketTypeAutocomplete,
  'ticket/type/remove': ticketTypeAutocomplete,
  'ticket/type/fields': ticketTypeAutocomplete,
  // /ticket manage *
  'ticket/manage/status': workflowStatusAutocomplete,
  'ticket/manage/user-restrict': ticketTypeAutocomplete,
  'ticket/manage/settings': ticketTypeAutocompleteWithBuiltin,
  // /ticket workflow *
  'ticket/workflow/remove-status': removableStatusAutocomplete,
  'ticket/workflow/autoclose-enable': workflowStatusAutocomplete,
  // /ticket sla *
  'ticket/sla/per-type': ticketTypeAutocomplete,
  // /ticket routing *
  'ticket/routing/rule-add': ticketTypeAutocomplete,
  'ticket/routing/rule-remove': routingRuleAutocomplete,
  // /application * (no subcommand group)
  'application//remove': applicationPositionAutocomplete,
  'application//toggle': applicationPositionAutocomplete,
  'application//edit': applicationPositionAutocomplete,
  'application//fields': applicationPositionAutocomplete,
  'application//status': applicationWorkflowStatusAutocomplete,
  'application//workflow-remove-status': applicationRemovableStatusAutocomplete,
  // /memory *
  'memory//update-status': memoryAutocomplete,
  'memory//update-tags': memoryAutocomplete,
  // /memory-setup *
  'memory-setup//tag-remove': memoryTagAutocomplete,
  'memory-setup//tag-edit': memoryTagAutocomplete,
  // /baitchannel detection *
  'baitchannel/detection/keywords': handleKeywordAutocomplete,
};

/**
 * Commands whose entire subcommand surface uses one autocomplete handler.
 * Falls back here when no exact `AUTOCOMPLETE_ROUTES` match is found.
 */
const COMMAND_AUTOCOMPLETE_ROUTES: Record<string, AutocompleteHandler> = {
  reactionrole: reactionRoleMenuAutocomplete,
  announcement: interaction => templateAutocomplete(interaction, choices => interaction.respond(choices)),
};

/** Handles autocomplete interactions for all commands. */
export const handleAutocomplete = async (_client: Client, interaction: AutocompleteInteraction) => {
  const commandName = interaction.commandName;
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;

  try {
    const group = interaction.options.getSubcommandGroup(false) ?? '';
    const subcommand = interaction.options.getSubcommand(false) ?? '';

    enhancedLogger.debug(`Autocomplete: /${commandName} ${group} ${subcommand}`, LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      guildId,
      subcommandGroup: group || undefined,
      subcommand: subcommand || undefined,
    });

    const exact = AUTOCOMPLETE_ROUTES[`${commandName}/${group}/${subcommand}`];
    if (exact) {
      await exact(interaction);
      return;
    }

    const fallback = COMMAND_AUTOCOMPLETE_ROUTES[commandName];
    if (fallback) {
      await fallback(interaction);
      return;
    }
    // No matching route — silently noop (autocomplete is best-effort)
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
    try {
      await interaction.respond([]);
    } catch {
      // Already responded or interaction expired
    }
  }
};

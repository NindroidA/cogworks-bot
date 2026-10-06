import type { AutocompleteInteraction, Client } from 'discord.js';
import { templateAutocomplete } from '../commands/handlers/announcement/templates';
import { applicationPositionAutocomplete } from '../commands/handlers/application/applicationPosition';
import {
  applicationRemovableStatusAutocomplete,
  applicationWorkflowStatusAutocomplete,
} from '../commands/handlers/application/workflow';
import { handleAutomodAutocomplete } from '../commands/handlers/automod';
import { handleKeywordAutocomplete } from '../commands/handlers/baitChannel/keywords';
import { scheduledEventAutocomplete } from '../commands/handlers/event/create';
import { eventTemplateAutocomplete } from '../commands/handlers/event/template';
import { memoryAutocomplete } from '../commands/handlers/memory';
import { memoryTagAutocomplete } from '../commands/handlers/memory/manageTags';
import { reactionRoleMenuAutocomplete } from '../commands/handlers/reactionRole';
import { routingRuleAutocomplete } from '../commands/handlers/ticket/routing';
import { ticketTypeAutocomplete, ticketTypeAutocompleteWithBuiltin } from '../commands/handlers/ticket/typeToggle';
import { removableStatusAutocomplete, workflowStatusAutocomplete } from '../commands/handlers/ticket/workflow';
import { enhancedLogger, LogCategory } from '../utils';
import { type Feature, hasFeatureAccess, type Level } from '../utils/validation/featurePermission';

type AutocompleteHandler = (interaction: AutocompleteInteraction) => Promise<void>;

/**
 * One autocomplete route. These commands are visible to everyone, so Discord
 * no longer filters who can trigger autocomplete: suggestions (ticket types,
 * memory titles, bait keywords, rule names) need the same feature and level
 * as the subcommand's own guard.
 */
export interface AutocompleteRoute {
  feature: Feature;
  level: Level;
  handler: AutocompleteHandler;
}

const manage = (feature: Feature, handler: AutocompleteHandler): AutocompleteRoute => ({
  feature,
  level: 'manage',
  handler,
});

const eventTemplates: AutocompleteHandler = interaction =>
  eventTemplateAutocomplete(interaction, choices => interaction.respond(choices));

/**
 * Per-(command, group, subcommand) autocomplete dispatch table.
 *
 * Key shape: `command/group/subcommand` — empty `group` becomes `command//subcommand`.
 * Adding a new autocomplete-using subcommand means adding one row here, not
 * patching a switch. For commands that handle every subcommand the same way
 * (e.g. `reactionrole`, `announcement`), see `COMMAND_AUTOCOMPLETE_ROUTES`.
 */
const AUTOCOMPLETE_ROUTES: Record<string, AutocompleteRoute> = {
  // /ticket type * — `edit` opens the read-only type view ('use'); the rest change types
  'ticket/type/edit': { feature: 'tickets', level: 'use', handler: ticketTypeAutocomplete },
  'ticket/type/toggle': manage('tickets', ticketTypeAutocomplete),
  'ticket/type/default': manage('tickets', ticketTypeAutocomplete),
  'ticket/type/remove': manage('tickets', ticketTypeAutocomplete),
  'ticket/type/fields': manage('tickets', ticketTypeAutocomplete),
  // /ticket manage *
  'ticket/manage/status': manage('tickets', workflowStatusAutocomplete),
  'ticket/manage/user-restrict': manage('tickets', ticketTypeAutocomplete),
  'ticket/manage/settings': manage('tickets', ticketTypeAutocompleteWithBuiltin),
  // /ticket workflow *
  'ticket/workflow/remove-status': manage('tickets', removableStatusAutocomplete),
  'ticket/workflow/autoclose-enable': manage('tickets', workflowStatusAutocomplete),
  // /ticket sla *
  'ticket/sla/per-type': manage('tickets', ticketTypeAutocomplete),
  // /ticket routing *
  'ticket/routing/rule-add': manage('tickets', ticketTypeAutocomplete),
  'ticket/routing/rule-remove': manage('tickets', routingRuleAutocomplete),
  // /application position * (these keys were `application//…` and never matched)
  'application/position/remove': manage('applications', applicationPositionAutocomplete),
  'application/position/toggle': manage('applications', applicationPositionAutocomplete),
  'application/position/edit': manage('applications', applicationPositionAutocomplete),
  'application/position/fields': manage('applications', applicationPositionAutocomplete),
  // /application * (no subcommand group)
  'application//status': manage('applications', applicationWorkflowStatusAutocomplete),
  'application//workflow-remove-status': manage('applications', applicationRemovableStatusAutocomplete),
  // /memory *
  'memory//update-status': manage('memory', memoryAutocomplete),
  'memory//update-tags': manage('memory', memoryAutocomplete),
  // /memory-setup *
  'memory-setup//tag-remove': manage('memory', memoryTagAutocomplete),
  'memory-setup//tag-edit': manage('memory', memoryTagAutocomplete),
  // /baitchannel detection *
  'baitchannel/detection/keywords': manage('baitchannel', handleKeywordAutocomplete),
  // /event * — template-name options (never wired until v3.14.3)
  'event//from-template': manage('events', eventTemplates),
  'event//recurring': manage('events', eventTemplates),
  'event/template/edit': manage('events', eventTemplates),
  'event/template/delete': manage('events', eventTemplates),
  // /event * — live scheduled-event options
  'event//cancel': manage('events', scheduledEventAutocomplete),
  'event//remind': manage('events', scheduledEventAutocomplete),
};

/**
 * Commands whose entire subcommand surface uses one autocomplete handler.
 * Falls back here when no exact `AUTOCOMPLETE_ROUTES` match is found.
 */
const COMMAND_AUTOCOMPLETE_ROUTES: Record<string, AutocompleteRoute> = {
  reactionrole: manage('reactionroles', reactionRoleMenuAutocomplete),
  announcement: manage('announcements', interaction =>
    templateAutocomplete(interaction, choices => interaction.respond(choices)),
  ),
  // Every flagged /automod option is a 'rule' picker (never wired until v3.14.3)
  automod: manage('automod', handleAutomodAutocomplete),
};

/** The route for an autocomplete interaction, if any. Exported for tests. */
export function resolveAutocompleteRoute(
  commandName: string,
  group: string,
  subcommand: string,
): AutocompleteRoute | undefined {
  return AUTOCOMPLETE_ROUTES[`${commandName}/${group}/${subcommand}`] ?? COMMAND_AUTOCOMPLETE_ROUTES[commandName];
}

/** Handles autocomplete interactions for all commands. */
export const handleAutocomplete = async (_client: Client, interaction: AutocompleteInteraction) => {
  const commandName = interaction.commandName;
  if (!interaction.guildId) return;
  const guildId = interaction.guildId;

  try {
    const group = interaction.options.getSubcommandGroup(false) ?? '';
    const subcommand = interaction.options.getSubcommand(false) ?? '';
    const route = resolveAutocompleteRoute(commandName, group, subcommand);

    // No route, or the caller lacks the subcommand's own access: no suggestions.
    if (!route || !(await hasFeatureAccess(interaction, route.feature, route.level)).allowed) {
      await interaction.respond([]);
      return;
    }

    enhancedLogger.debug(`Autocomplete: /${commandName} ${group} ${subcommand}`, LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      guildId,
      subcommandGroup: group || undefined,
      subcommand: subcommand || undefined,
    });

    await route.handler(interaction);
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

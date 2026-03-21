import {
  type CacheType,
  type ChatInputCommandInteraction,
  type Client,
  MessageFlags,
} from 'discord.js';
import { BotConfig } from '../typeorm/entities/BotConfig';
import {
  createRateLimitKey,
  enhancedLogger,
  healthMonitor,
  LogCategory,
  lang,
  RateLimits,
  rateLimiter,
} from '../utils';
import { writeAuditLog } from '../utils/api/handlers/auditHelper';
import { lazyRepo } from '../utils/database/lazyRepo';
import { announcementHandler } from './handlers/announcement';
import { announcementSetupHandler } from './handlers/announcement/setup';
import { applicationEditHandler } from './handlers/application/applicationEdit';
import { applicationFieldsHandler } from './handlers/application/applicationFields';
import { applicationPositionHandler } from './handlers/application/applicationPosition';
import { applicationSetupHandler } from './handlers/application/applicationSetup';
import { automodHandler } from './handlers/automod';
import { baitChannelHandler } from './handlers/baitChannel';
import { botSetupHandler } from './handlers/botSetup';
import { coffeeHandler } from './handlers/coffee';
import { dashboardHandler } from './handlers/dashboard';
import { dataExportHandler } from './handlers/dataExport';
import {
  deleteAllArchivedApplicationsHandler,
  deleteArchivedApplicationHandler,
} from './handlers/dev/applicationDev';
import { devSuiteHandler } from './handlers/dev/devSuite';
import { devTestHandler } from './handlers/dev/devTest';
import {
  bulkCloseTicketsHandler,
  deleteAllArchivedTicketsHandler,
  deleteArchivedTicketHandler,
} from './handlers/dev/ticketDev';
import { eventHandler } from './handlers/event';
import { importHandler } from './handlers/import';
import { insightsHandler } from './handlers/insights';
import {
  memoryAddHandler,
  memoryCaptureHandler,
  memoryDeleteHandler,
  memoryTagsHandler,
  memoryUpdateHandler,
  memoryUpdateStatusHandler,
  memoryUpdateTagsHandler,
} from './handlers/memory';
import { memorySetupHandler } from './handlers/memorySetup';
import { migrateApplicationTagsHandler, migrateTicketTagsHandler } from './handlers/migrate';
import { onboardingHandler } from './handlers/onboarding';
import { pingHandler } from './handlers/ping';
import { reactionRoleHandler } from './handlers/reactionRole';
import { roleAddHandler, roleListHandler, roleRemoveHandler } from './handlers/role';
import { rulesSetupHandler } from './handlers/rulesSetup';
import { serverCommandHandler } from './handlers/serverCommand';
import { starboardHandler } from './handlers/starboard';
import { statusHandler } from './handlers/status';
import {
  autoCloseDisableHandler,
  autoCloseEnableHandler,
  emailImportHandler,
  settingsHandler,
  ticketAssignHandler,
  ticketInfoHandler,
  ticketStatusHandler,
  ticketUnassignHandler,
  typeAddHandler,
  typeDefaultHandler,
  typeEditHandler,
  typeFieldsHandler,
  typeListHandler,
  typeRemoveHandler,
  typeToggleHandler,
  userRestrictHandler,
  workflowAddStatusHandler,
  workflowDisableHandler,
  workflowEnableHandler,
  workflowRemoveStatusHandler,
} from './handlers/ticket';
import { ticketSetupHandler } from './handlers/ticketSetup';
import {
  leaderboardCommandHandler,
  rankCommandHandler,
  xpAdminCommandHandler,
  xpSetupCommandHandler,
} from './handlers/xp';

// ---------------------------------------------------------------------------
// Handler type aliases
// ---------------------------------------------------------------------------

type FullHandler = (
  client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
) => Promise<void>;
type InteractionHandler = (interaction: ChatInputCommandInteraction<CacheType>) => Promise<void>;

// ---------------------------------------------------------------------------
// Route tables
// ---------------------------------------------------------------------------

/** Commands that take (client, interaction) */
const CLIENT_ROUTES: Record<string, FullHandler> = {
  'ticket-setup': ticketSetupHandler,
  'memory-setup': memorySetupHandler,
  'application-setup': applicationSetupHandler,
  'announcement-setup': announcementSetupHandler,
  announcement: announcementHandler,
  baitchannel: baitChannelHandler,
  'data-export': dataExportHandler,
  'rules-setup': rulesSetupHandler,
  reactionrole: reactionRoleHandler,
  starboard: starboardHandler,
  status: statusHandler,
  'xp-setup': xpSetupCommandHandler,
  xp: xpAdminCommandHandler,
  rank: rankCommandHandler,
  leaderboard: leaderboardCommandHandler,
  onboarding: onboardingHandler,
  automod: automodHandler,
  event: eventHandler,
  insights: insightsHandler,
  'dev-test': devTestHandler,
  'dev-suite': devSuiteHandler,
};

/** Commands that only take (interaction) */
const SIMPLE_ROUTES: Record<string, InteractionHandler> = {
  ping: pingHandler,
  coffee: coffeeHandler,
  server: serverCommandHandler,
  dashboard: dashboardHandler,
  import: importHandler,
};

/** Subcommand routers keyed by parent command → subcommand → handler */
const SUBCOMMAND_ROUTES: Record<string, Record<string, InteractionHandler>> = {
  ticket: {
    'type-add': typeAddHandler,
    'type-edit': typeEditHandler,
    'type-list': typeListHandler,
    'type-toggle': typeToggleHandler,
    'type-default': typeDefaultHandler,
    'type-remove': typeRemoveHandler,
    'type-fields': typeFieldsHandler,
    'import-email': emailImportHandler,
    'user-restrict': userRestrictHandler,
    settings: settingsHandler,
    status: ticketStatusHandler,
    assign: ticketAssignHandler,
    unassign: ticketUnassignHandler,
    info: ticketInfoHandler,
    'workflow-enable': workflowEnableHandler,
    'workflow-disable': workflowDisableHandler,
    'workflow-add-status': workflowAddStatusHandler,
    'workflow-remove-status': workflowRemoveStatusHandler,
    'autoclose-enable': autoCloseEnableHandler,
    'autoclose-disable': autoCloseDisableHandler,
  },
  memory: {
    add: memoryAddHandler,
    capture: memoryCaptureHandler,
    update: memoryUpdateHandler,
    'update-status': memoryUpdateStatusHandler,
    'update-tags': memoryUpdateTagsHandler,
    delete: memoryDeleteHandler,
    tags: memoryTagsHandler,
  },
  dev: {
    'bulk-close-tickets': bulkCloseTicketsHandler,
    'delete-archived-ticket': deleteArchivedTicketHandler,
    'delete-all-archived-tickets': deleteAllArchivedTicketsHandler,
    'delete-archived-application': deleteArchivedApplicationHandler,
    'delete-all-archived-applications': deleteAllArchivedApplicationsHandler,
  },
  migrate: {
    'ticket-tags': migrateTicketTagsHandler,
    'application-tags': migrateApplicationTagsHandler,
  },
};

const botConfigRepo = lazyRepo(BotConfig);

// ---------------------------------------------------------------------------
// Main command dispatcher
// ---------------------------------------------------------------------------

export const handleSlashCommand = async (
  client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
) => {
  const startTime = Date.now();
  const user = interaction.user.username;
  const commandName = interaction.commandName;
  const guildId = interaction.guildId;

  enhancedLogger.command(`/${commandName} executed`, interaction.user.id, guildId || undefined, {
    username: user,
    commandName,
  });

  // Global rate limit check (30 commands per minute per user)
  const globalRateLimitKey = createRateLimitKey.globalUser(interaction.user.id);
  const globalRateCheck = rateLimiter.check(globalRateLimitKey, RateLimits.GLOBAL_COMMAND);

  if (!globalRateCheck.allowed) {
    await interaction.reply({
      content: globalRateCheck.message,
      flags: [MessageFlags.Ephemeral],
    });
    enhancedLogger.warn(`User ${user} hit global command rate limit`, LogCategory.SECURITY);
    healthMonitor.recordCommand(commandName, Date.now() - startTime, false);
    return;
  }

  if (!guildId) {
    await interaction.reply({ content: lang.general.cmdGuildNotFound });
    healthMonitor.recordCommand(commandName, Date.now() - startTime, true);
    enhancedLogger.error(lang.general.cmdGuildNotFound, undefined, LogCategory.COMMAND_EXECUTION);
    return;
  }

  try {
    // bot-setup is allowed without prior config
    if (commandName === 'bot-setup') {
      await botSetupHandler(client, interaction);
    } else {
      const botConfig = await botConfigRepo.findOneBy({ guildId });
      if (!botConfig) {
        enhancedLogger.warn(lang.botConfig.notFound, LogCategory.COMMAND_EXECUTION);
        await interaction.reply({
          content: lang.botConfig.notFound,
          flags: [MessageFlags.Ephemeral],
        });
      } else {
        await dispatchCommand(client, interaction, commandName);
      }
    }

    logCommandAudit(interaction, commandName, guildId);

    const executionTime = Date.now() - startTime;
    healthMonitor.recordCommand(commandName, executionTime, false);
    enhancedLogger.performance(`Command /${commandName} completed`, executionTime, {
      userId: interaction.user.id,
      guildId,
    });
  } catch (error) {
    const executionTime = Date.now() - startTime;
    healthMonitor.recordCommand(commandName, executionTime, true);
    healthMonitor.recordError(`Command failed: ${commandName}`, 'COMMAND');

    enhancedLogger.error(
      `Command /${commandName} failed`,
      error as Error,
      LogCategory.COMMAND_EXECUTION,
      { userId: interaction.user.id, guildId, commandName },
    );

    try {
      await interaction.reply({
        content: '❌ An error occurred while executing this command. Please try again later.',
        flags: [MessageFlags.Ephemeral],
      });
    } catch {
      // Interaction may have already been replied to
    }
  }
};

// ---------------------------------------------------------------------------
// Dispatcher logic
// ---------------------------------------------------------------------------

async function dispatchCommand(
  client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
  commandName: string,
): Promise<void> {
  // 1. Client routes (handler takes client + interaction)
  const clientHandler = CLIENT_ROUTES[commandName];
  if (clientHandler) {
    await clientHandler(client, interaction);
    return;
  }

  // 2. Simple routes (handler takes only interaction)
  const simpleHandler = SIMPLE_ROUTES[commandName];
  if (simpleHandler) {
    await simpleHandler(interaction);
    return;
  }

  // 3. Subcommand routes
  const subRoutes = SUBCOMMAND_ROUTES[commandName];
  if (subRoutes) {
    const subcommand = interaction.options.getSubcommand();
    const handler = subRoutes[subcommand];
    if (handler) {
      await handler(interaction);
    }
    return;
  }

  // 4. Special cases with subcommand groups
  if (commandName === 'role') {
    await dispatchRoleCommand(interaction);
    return;
  }

  if (commandName === 'application') {
    await dispatchApplicationCommand(client, interaction);
  }
}

async function dispatchRoleCommand(
  interaction: ChatInputCommandInteraction<CacheType>,
): Promise<void> {
  const subcommandGroup = interaction.options.getSubcommandGroup(false);
  const subcommand = interaction.options.getSubcommand();

  if (subcommandGroup === 'add') {
    await roleAddHandler(interaction);
  } else if (subcommandGroup === 'remove') {
    await roleRemoveHandler(interaction);
  } else if (subcommand === 'list') {
    await roleListHandler(interaction);
  }
}

async function dispatchApplicationCommand(
  client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
): Promise<void> {
  const group = interaction.options.getSubcommandGroup(false);
  if (group !== 'position') return;

  const subcommand = interaction.options.getSubcommand();
  switch (subcommand) {
    case 'edit':
      await applicationEditHandler(interaction);
      break;
    case 'fields':
      await applicationFieldsHandler(interaction);
      break;
    default:
      await applicationPositionHandler(client, interaction);
      break;
  }
}

// ---------------------------------------------------------------------------
// Audit logging
// ---------------------------------------------------------------------------

const AUDITABLE_COMMANDS = new Set([
  'bot-setup',
  'ticket-setup',
  'application-setup',
  'announcement-setup',
  'memory-setup',
  'rules-setup',
  'announcement',
  'baitchannel',
  'reactionrole',
  'starboard',
  'data-export',
  'import',
  'xp-setup',
  'onboarding',
  'automod',
  'event',
]);

const AUDITABLE_TICKET_SUBCOMMANDS = new Set([
  'type-add',
  'type-edit',
  'type-toggle',
  'type-default',
  'type-remove',
  'type-fields',
  'import-email',
  'user-restrict',
  'settings',
  'status',
  'assign',
  'unassign',
  'workflow-enable',
  'workflow-disable',
  'workflow-add-status',
  'workflow-remove-status',
  'autoclose-enable',
  'autoclose-disable',
]);

const AUDITABLE_MEMORY_SUBCOMMANDS = new Set([
  'add',
  'capture',
  'update',
  'update-status',
  'update-tags',
  'delete',
]);

const AUDITABLE_ROLE_GROUPS = new Set(['add', 'remove']);

function logCommandAudit(
  interaction: ChatInputCommandInteraction<CacheType>,
  commandName: string,
  guildId: string,
): void {
  let action: string | null = null;
  const details: Record<string, unknown> = {};

  if (AUDITABLE_COMMANDS.has(commandName)) {
    action = `command:${commandName}`;
  } else if (commandName === 'ticket') {
    const sub = interaction.options.getSubcommand(false);
    if (sub && AUDITABLE_TICKET_SUBCOMMANDS.has(sub)) {
      action = `command:ticket:${sub}`;
      details.subcommand = sub;
    }
  } else if (commandName === 'memory') {
    const sub = interaction.options.getSubcommand(false);
    if (sub && AUDITABLE_MEMORY_SUBCOMMANDS.has(sub)) {
      action = `command:memory:${sub}`;
      details.subcommand = sub;
    }
  } else if (commandName === 'role') {
    const group = interaction.options.getSubcommandGroup(false);
    if (group && AUDITABLE_ROLE_GROUPS.has(group)) {
      action = `command:role:${group}`;
      details.subcommandGroup = group;
    }
  } else if (commandName === 'application') {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand(false);
    if (group === 'position' && sub) {
      action = `command:application:position:${sub}`;
      details.subcommand = sub;
    }
  }

  if (action) {
    writeAuditLog(guildId, action, interaction.user.id, details, 'command');
  }
}

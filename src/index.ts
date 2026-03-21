import { Client, GatewayIntentBits, Partials, Routes } from 'discord.js';
import dotenv from 'dotenv';
import 'reflect-metadata';
import { commands } from './commands/commandList';
import { handleSlashCommand } from './commands/commands';
import { stopFieldSessionCleanup } from './commands/handlers/application/applicationFields';
import { stopFieldDraftCleanup } from './commands/handlers/shared/fieldManagerCore';
import { handleAutocomplete } from './events/autocomplete';
import channelDeleteEvent from './events/channelDelete';
import guildCreateEvent from './events/guildCreate';
import guildDeleteEvent from './events/guildDelete';
import guildMemberAddEvent from './events/guildMemberAdd';
import { routeInteraction } from './events/interactionRouter';
import messageCreateEvent from './events/messageCreate';
import messageDeleteEvent from './events/messageDelete';
import {
  handleReactionRoleAdd,
  handleReactionRoleRemove,
  stopReactionRoleCooldownCleanup,
} from './events/reactionRoleHandler';
import {
  handleRulesReactionAdd,
  handleRulesReactionRemove,
  stopRulesCooldownCleanup,
} from './events/rulesReaction';
import {
  handleStarboardReactionAdd,
  handleStarboardReactionRemove,
} from './events/starboardReaction';
import { AppDataSource } from './typeorm';
import { BaitChannelConfig } from './typeorm/entities/BaitChannelConfig';
import { BaitChannelLog } from './typeorm/entities/BaitChannelLog';
import { BotConfig } from './typeorm/entities/BotConfig';
import { BaitKeyword } from './typeorm/entities/bait/BaitKeyword';
import { PendingBan } from './typeorm/entities/PendingBan';
import { UserActivity } from './typeorm/entities/UserActivity';
import type { ExtendedClient } from './types/ExtendedClient';
import {
  E,
  enhancedLogger,
  ensureDefaultTicketTypes,
  healthMonitor,
  healthServer,
  INTERVALS,
  internalApiServer,
  LegacyMigrationRunner,
  LogCategory,
  lang,
  memoryWatchdog,
  rateLimiter,
} from './utils';
import { APIConnector } from './utils/apiConnector';
import { JoinVelocityTracker } from './utils/baitChannel/joinVelocityTracker';
import { checkAndSendWeeklySummaries } from './utils/baitChannel/weeklySummary';
import { BaitChannelManager } from './utils/baitChannelManager';
import { startLogCleanup, stopLogCleanup } from './utils/database/logCleanup';
import { announcementRoleRename } from './utils/database/migrations/announcementRoleRename';
import { baitChannelIdsBackfill } from './utils/database/migrations/baitChannelIdsBackfill';
import { setupGlobalErrorHandlers } from './utils/errorHandler';
import { setDescription, setStatus } from './utils/profileFunctions';
import { StatusManager } from './utils/status/StatusManager';
import { checkAndAutoCloseTickets } from './utils/ticket/autoClose';

dotenv.config();

// Setup global error handlers for unhandled rejections and exceptions
// gracefulShutdown is hoisted — safe to reference before its textual position
setupGlobalErrorHandlers(gracefulShutdown);

const tl = lang.main;

// validate RELEASE env variable
const RELEASE = (process.env.RELEASE || 'prod').toLowerCase().trim();
const IS_DEV = RELEASE === 'dev';

// validate RELEASE value
if (RELEASE !== 'prod' && RELEASE !== 'dev') {
  console.error(tl.invalidRelease.replace('{0}', process.env.RELEASE || ''));
}

let TOKEN = process.env.BOT_TOKEN!; // default production bot token
let CLIENT = process.env.CLIENT_ID!; // default production bot client

// if release is dev, use development bot credentials
if (IS_DEV) {
  // make sure dev credentials exist
  if (!process.env.DEV_BOT_TOKEN || !process.env.DEV_CLIENT_ID) {
    console.error(tl.missingDevCreds);
    console.error(tl.addToEnv);
    process.exit(1);
  }

  TOKEN = process.env.DEV_BOT_TOKEN!;
  CLIENT = process.env.DEV_CLIENT_ID!;
  // log that we're using the development bot
  console.log(`${E.dev} ${lang.main.usingDev}`);
} else {
  // validate production credentials exist
  if (!process.env.BOT_TOKEN || !process.env.CLIENT_ID) {
    console.error(`${E.error} ${tl.missingProdCreds}`);
    console.error(`${E.warn} ${tl.addToEnv}`);
    process.exit(1);
  }
  console.log(`${E.prod} ${tl.usingProd}`);
}

// create new discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.User],
});

// Shared REST client (also used by guildCreate event handler)
import { rest } from './utils/restClient';

/* init API connector */
const apiConnector = new APIConnector(
  process.env.API_URL || 'http://localhost:3001', // default to localhost and port 3001 if not set
  TOKEN, // bot token for authentication
);

// Interval refs (set in clientReady, cleared on shutdown)
let healthMonitorInterval: ReturnType<typeof setInterval> | null = null;
let weeklySummaryInterval: ReturnType<typeof setInterval> | null = null;
let autoCloseInterval: ReturnType<typeof setInterval> | null = null;

// listen for interactions
client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) {
    client.emit('chatInputCommand', client, interaction);
  } else if (interaction.isAutocomplete()) {
    client.emit('autocomplete', client, interaction);
  } else if (
    interaction.isButton() ||
    interaction.isStringSelectMenu() ||
    interaction.isModalSubmit()
  ) {
    await routeInteraction(client, interaction);
  }
});

// register event handlers
client.on('chatInputCommand', handleSlashCommand); // handle when slash commands are sent
client.on('autocomplete', handleAutocomplete); // handle autocomplete interactions

// register reaction events (rules acknowledgment + reaction roles)
client.on('messageReactionAdd', (reaction, user) => handleRulesReactionAdd(reaction, user, client));
client.on('messageReactionRemove', (reaction, user) =>
  handleRulesReactionRemove(reaction, user, client),
);
client.on('messageReactionAdd', (reaction, user) => handleReactionRoleAdd(reaction, user, client));
client.on('messageReactionRemove', (reaction, user) =>
  handleReactionRoleRemove(reaction, user, client),
);
client.on('messageReactionAdd', (reaction, user) =>
  handleStarboardReactionAdd(reaction, user, client),
);
client.on('messageReactionRemove', (reaction, user) =>
  handleStarboardReactionRemove(reaction, user, client),
);

// register message events
// Note: These handlers accept ExtendedClient, which is safe because they only fire
// after the client is ready and managers are attached in the clientReady event.
const extClient = client as ExtendedClient;
client.on(messageCreateEvent.name, message => messageCreateEvent.execute(message, extClient));
client.on(messageDeleteEvent.name, message => messageDeleteEvent.execute(message, extClient));

// register guild lifecycle events
client.on(guildCreateEvent.name, guild => guildCreateEvent.execute(guild, client));
client.on(guildDeleteEvent.name, guild => guildDeleteEvent.execute(guild, client));

// register channel lifecycle events
client.on(channelDeleteEvent.name, channel => channelDeleteEvent.execute(channel, extClient));

// register member lifecycle events
client.on(guildMemberAddEvent.name, member => guildMemberAddEvent.execute(member, extClient));

// once we ready, LEGGO
client.once('clientReady', async () => {
  // initialize health monitor first
  healthMonitor.initialize(client);

  // THEN initialize health server
  healthServer.initialize(client);
  const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || '3000', 10);
  healthServer.start(HEALTH_PORT);

  // log that we logged in
  console.log(`${E.ready} ${tl.ready}${client.user?.tag}`);
  enhancedLogger.info(`Bot started successfully: ${client.user?.tag}`, LogCategory.SYSTEM, {
    environment: IS_DEV ? 'development' : 'production',
    guilds: client.guilds.cache.size,
    users: client.users.cache.size,
    healthPort: HEALTH_PORT,
  });

  // log environment info
  console.log(tl.envSeparator);
  console.log(
    `${E.list} ${tl.envLabel}${IS_DEV ? `${E.wrench} ${tl.envDev}` : `${E.prod} ${tl.envProd}`}`,
  );
  console.log(`${E.bot} ${tl.botLabel}${client.user?.tag}`);
  console.log(`${E.id} ${tl.clientIdLabel}${CLIENT}`);
  console.log(tl.envSeparator);

  // initialize bait channel manager
  const baitChannelManager = new BaitChannelManager(
    client,
    AppDataSource.getRepository(BaitChannelConfig),
    AppDataSource.getRepository(BaitChannelLog),
    AppDataSource.getRepository(UserActivity),
    AppDataSource.getRepository(PendingBan),
    AppDataSource.getRepository(BaitKeyword),
  );
  await baitChannelManager.initialize();
  baitChannelManager.startActivityFlush();

  // initialize join velocity tracker for burst detection
  const joinVelocityTracker = new JoinVelocityTracker();
  joinVelocityTracker.startCleanupInterval();
  baitChannelManager.setJoinVelocityTracker(joinVelocityTracker);

  // attach to client for access in events and commands
  (client as ExtendedClient).baitChannelManager = baitChannelManager;
  (client as ExtendedClient).joinVelocityTracker = joinVelocityTracker;
  console.log(`${E.target} ${tl.baitChannelInit}`);
  enhancedLogger.info('Bait channel manager initialized', LogCategory.SYSTEM);

  // initialize status manager
  const statusManager = new StatusManager(client, IS_DEV);
  (client as ExtendedClient).statusManager = statusManager;
  await statusManager.updatePresence(); // Set initial presence from DB
  healthMonitor.setStatusManager(statusManager);
  enhancedLogger.info('Status manager initialized', LogCategory.SYSTEM);

  // set bot profile customizations (with dev mode indicator)
  setDescription(client, IS_DEV);
  setStatus(client, IS_DEV);

  // connect to API server (skip in dev mode)
  if (!IS_DEV) {
    await apiConnector.registerBot(client);

    if (apiConnector.isConnectedToAPI()) {
      console.log(`${E.ok} ${tl.apiConnected}`);
      enhancedLogger.info('Connected to API server successfully', LogCategory.API);
      apiConnector.startStatsSync(client);
    } else {
      console.warn(`${E.warn} ${tl.apiContinueWarning}`);
      enhancedLogger.warn('API registration failed, continuing without it', LogCategory.API);
    }
  } else {
    console.log(`${E.wrench} ${tl.apiSkipDev}`);
    enhancedLogger.info(tl.apiSkipDev, LogCategory.SYSTEM);
  }

  // Initialize internal API server (for dashboard integration)
  if (process.env.COGWORKS_INTERNAL_API_TOKEN) {
    internalApiServer.initialize(client);
    const INTERNAL_API_PORT = Number.parseInt(process.env.BOT_INTERNAL_PORT || '3002', 10);
    internalApiServer.start(INTERNAL_API_PORT);
  }

  // start periodic health status logging (every 5 minutes)
  healthMonitorInterval = setInterval(async () => {
    await healthMonitor.logHealthStatus();
  }, INTERVALS.HEALTH_STATUS);

  // start daily log cleanup (bait channel logs: 90d, announcement logs: 365d)
  startLogCleanup();

  // Initialize memory watchdog — register tracked maps and start
  memoryWatchdog.setClient(client);
  memoryWatchdog.trackMap('rateLimiter', () => rateLimiter.getSize());
  const baitMaps = (client as ExtendedClient).baitChannelManager.getTrackedMaps();
  for (const [name, _size] of Object.entries(baitMaps)) {
    memoryWatchdog.trackMap(
      `bait.${name}`,
      () => (client as ExtendedClient).baitChannelManager.getTrackedMaps()[name],
    );
  }
  memoryWatchdog.start();
  enhancedLogger.info('Memory watchdog started', LogCategory.SYSTEM);

  // Start weekly summary check (hourly, fires Sunday 00:xx UTC)
  weeklySummaryInterval = setInterval(() => {
    checkAndSendWeeklySummaries(client).catch(error => {
      enhancedLogger.error('Weekly summary check failed', error as Error, LogCategory.ERROR);
    });
  }, INTERVALS.WEEKLY_SUMMARY);

  // Start auto-close ticket check (hourly)
  autoCloseInterval = setInterval(() => {
    checkAndAutoCloseTickets(client).catch(error => {
      enhancedLogger.error('Auto-close ticket check failed', error as Error, LogCategory.ERROR);
    });
  }, INTERVALS.AUTO_CLOSE_CHECK);

  enhancedLogger.info(
    'Periodic health monitoring started (5 minute intervals)',
    LogCategory.SYSTEM,
  );

  // just a lil line for the console
  console.log(tl.line);
});

// Graceful shutdown handler
async function gracefulShutdown(signal: string) {
  console.log(`${E.shutdown} ${tl.shuttingDown}`);
  enhancedLogger.info(`Received ${signal}, shutting down gracefully`, LogCategory.SYSTEM);

  // stop cleanup intervals
  stopFieldDraftCleanup();
  stopFieldSessionCleanup();
  stopReactionRoleCooldownCleanup();
  stopRulesCooldownCleanup();
  stopLogCleanup();
  healthMonitor.stopPeriodicChecks();
  rateLimiter.destroy();
  memoryWatchdog.stop();
  if (healthMonitorInterval) clearInterval(healthMonitorInterval);
  if (weeklySummaryInterval) clearInterval(weeklySummaryInterval);
  if (autoCloseInterval) clearInterval(autoCloseInterval);

  // stop bait channel activity flush and write remaining buffer to DB
  const extClient = client as ExtendedClient;
  if (extClient.baitChannelManager) {
    extClient.baitChannelManager.stopActivityFlush();
    await extClient.baitChannelManager.flushActivityBuffer();
  }

  // destroy join velocity tracker (clear interval + free memory)
  if (extClient.joinVelocityTracker) {
    extClient.joinVelocityTracker.destroy();
  }

  // stop servers
  await internalApiServer.stop();
  await healthServer.stop();

  if (!IS_DEV) {
    await apiConnector.disconnect();
  }

  // flush any pending logs
  await enhancedLogger.flush();

  // dethrone the king
  client.destroy();
  process.exit(0);
}

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// main function to do all the things
async function main() {
  try {
    // remove any global application commands we had in place (refresh it)
    await rest.put(Routes.applicationCommands(CLIENT), {
      body: [],
    });

    // initialize typeORM shtuff
    await AppDataSource.initialize();

    // get all guild ids that have done the bot setup
    const botConfigRepo = AppDataSource.getRepository(BotConfig);
    const botConfigs = await botConfigRepo.find();

    // ensure default ticket types for all guilds (migration)
    for (const config of botConfigs) {
      try {
        await ensureDefaultTicketTypes(config.guildId);
      } catch (error) {
        console.error(`Failed to ensure default ticket types for guild ${config.guildId}:`, error);
      }
    }

    // Run legacy data migrations (after TypeORM sync, before command registration)
    const guildIds = botConfigs.map(c => c.guildId);
    if (guildIds.length > 0) {
      try {
        const migrationRunner = new LegacyMigrationRunner({
          concurrency: 5,
          dryRun: false,
        });
        migrationRunner.register(announcementRoleRename);
        migrationRunner.register(baitChannelIdsBackfill);

        const report = await migrationRunner.runAll(guildIds);
        const totalChanges = report.results.reduce((sum, r) => sum + r.totalChanges, 0);

        if (totalChanges > 0) {
          enhancedLogger.info('Legacy data migrations completed', LogCategory.DATABASE, {
            totalChanges,
            durationMs: report.durationMs,
          });
        }

        // Log warnings for failed migrations (don't block startup)
        for (const result of report.results) {
          for (const failure of result.failures) {
            enhancedLogger.warn(
              `Legacy migration '${result.migrationId}' failed for guild ${failure.guildId}: ${failure.error}`,
              LogCategory.DATABASE,
            );
          }
        }
      } catch (error) {
        enhancedLogger.warn(
          'Legacy migration runner failed — continuing startup',
          LogCategory.DATABASE,
          { error: error instanceof Error ? error.message : String(error) },
        );
      }
    }

    // log all startup info together before enhanced logging
    if (botConfigs.length > 0) {
      // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring
      console.log(tl.foundConfigs + botConfigs.length);
    } else {
      console.warn(tl.noFoundConfigs);
    }

    // register commands for each guild found in database (in parallel)
    const registrationResults = await Promise.allSettled(
      botConfigs.map(config =>
        rest
          .put(Routes.applicationGuildCommands(CLIENT, config.guildId), {
            body: commands,
          })
          .then(() => {
            // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring
            console.log(tl.regCmdsSuccess + config.guildId);
          }),
      ),
    );
    for (let i = 0; i < registrationResults.length; i++) {
      const result = registrationResults[i];
      if (result.status === 'rejected') {
        // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring
        console.error(`${tl.regCmdsFail}${botConfigs[i].guildId}:`, result.reason);
      }
    }

    // now log everything to enhanced logger after console messages are done
    enhancedLogger.info('Database connection established', LogCategory.DATABASE);

    if (botConfigs.length > 0) {
      enhancedLogger.info(`Found ${botConfigs.length} guild configurations`, LogCategory.SYSTEM, {
        configCount: botConfigs.length,
      });
    } else {
      enhancedLogger.warn('No guild configurations found', LogCategory.SYSTEM);
    }

    enhancedLogger.info('Command registration complete', LogCategory.SYSTEM, {
      guildsRegistered: botConfigs.length,
    });

    // log in
    await client.login(TOKEN);
    enhancedLogger.info('Bot logged in successfully', LogCategory.SYSTEM);
  } catch (error) {
    // if there's an error on startup, log it, and exit
    console.error(tl.error, error);
    enhancedLogger.critical('Fatal error during bot startup', error as Error, LogCategory.ERROR);
    process.exit(1);
  }
}

// NOW LEGGOOOOOOO
main();

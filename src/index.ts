import { Client, GatewayIntentBits, Partials, REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
import 'reflect-metadata';
import { commands } from './commands/commandList';
import { handleSlashCommand } from './commands/commands';
import { handleApplicationInteraction } from './events/applicationInteraction';
import { handleAutocomplete } from './events/autocomplete';
import channelDeleteEvent from './events/channelDelete';
import guildCreateEvent from './events/guildCreate';
import guildDeleteEvent from './events/guildDelete';
import messageCreateEvent from './events/messageCreate';
import messageDeleteEvent from './events/messageDelete';
import { handleReactionRoleAdd, handleReactionRoleRemove } from './events/reactionRoleHandler';
import { handleRulesReactionAdd, handleRulesReactionRemove } from './events/rulesReaction';
import { handleTicketInteraction } from './events/ticketInteraction';
import { typeFieldsInteraction } from './events/typeFieldsInteraction';
import { AppDataSource } from './typeorm';
import { BaitChannelConfig } from './typeorm/entities/BaitChannelConfig';
import { BaitChannelLog } from './typeorm/entities/BaitChannelLog';
import { BotConfig } from './typeorm/entities/BotConfig';
import { UserActivity } from './typeorm/entities/UserActivity';
import {
  E,
  enhancedLogger,
  ensureDefaultTicketTypes,
  healthMonitor,
  healthServer,
  LogCategory,
  lang,
} from './utils';
import { APIConnector } from './utils/apiConnector';
import { BaitChannelManager } from './utils/baitChannelManager';
import { setupGlobalErrorHandlers } from './utils/errorHandler';
import { setDescription, setStatus } from './utils/profileFunctions';
import { StatusManager } from './utils/status/StatusManager';

dotenv.config();

// Setup global error handlers for unhandled rejections and exceptions
setupGlobalErrorHandlers();

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
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.User],
});

// create new REST client and set bot token
const rest = new REST({ version: '10' }).setToken(TOKEN);

/* init API connector */
const apiConnector = new APIConnector(
  process.env.API_URL || 'http://localhost:3001', // default to localhost and port 3001 if not set
  TOKEN, // bot token for authentication
);

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
    client.emit('buttonInteraction', client, interaction);
  }
});

// register event handlers
client.on('chatInputCommand', handleSlashCommand); // handle when slash commands are sent
client.on('autocomplete', handleAutocomplete); // handle autocomplete interactions
client.on('buttonInteraction', handleTicketInteraction); // handle ticket interaction button presses
client.on('buttonInteraction', handleApplicationInteraction); // handle application interaction button presses
client.on('buttonInteraction', typeFieldsInteraction); // handle type-fields interaction (buttons/selects/modals)

// register reaction events (rules acknowledgment + reaction roles)
client.on('messageReactionAdd', (reaction, user) => handleRulesReactionAdd(reaction, user, client));
client.on('messageReactionRemove', (reaction, user) =>
  handleRulesReactionRemove(reaction, user, client),
);
client.on('messageReactionAdd', (reaction, user) => handleReactionRoleAdd(reaction, user, client));
client.on('messageReactionRemove', (reaction, user) =>
  handleReactionRoleRemove(reaction, user, client),
);

// register message events
client.on(messageCreateEvent.name, message => messageCreateEvent.execute(message, client));
client.on(messageDeleteEvent.name, message => messageDeleteEvent.execute(message, client));

// register guild lifecycle events
client.on(guildCreateEvent.name, guild => guildCreateEvent.execute(guild, client));
client.on(guildDeleteEvent.name, guild => guildDeleteEvent.execute(guild, client));

// register channel lifecycle events
client.on(channelDeleteEvent.name, channel => channelDeleteEvent.execute(channel, client));

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
  );

  // attach to client for access in events and commands
  (client as typeof client & { baitChannelManager: BaitChannelManager }).baitChannelManager =
    baitChannelManager;
  console.log(`${E.target} ${tl.baitChannelInit}`);
  enhancedLogger.info('Bait channel manager initialized', LogCategory.SYSTEM);

  // initialize status manager
  const statusManager = new StatusManager(client, IS_DEV);
  (client as typeof client & { statusManager: StatusManager }).statusManager = statusManager;
  await statusManager.updatePresence(); // Set initial presence from DB
  healthMonitor.setStatusManager(statusManager);
  enhancedLogger.info('Status manager initialized', LogCategory.SYSTEM);

  // set bot profile customizations (with dev mode indicator)
  setDescription(client, IS_DEV);
  setStatus(client, IS_DEV);

  // connect to API server (skip in dev mode)
  if (!IS_DEV) {
    try {
      await apiConnector.registerBot(client);
      console.log(`${E.ok} ${tl.apiConnected}`);
      enhancedLogger.info('Connected to API server successfully', LogCategory.API);

      apiConnector.startStatsSync(client);
    } catch (error) {
      console.error(`${E.error} ${tl.apiConnectFailed}`);
      console.warn(`${E.warn} ${tl.apiContinueWarning}`);
      enhancedLogger.error(
        'Failed to connect to API server, continuing without it',
        error as Error,
        LogCategory.API,
      );
    }
  } else {
    console.log(`${E.wrench} ${tl.apiSkipDev}`);
    enhancedLogger.info(tl.apiSkipDev, LogCategory.SYSTEM);
  }

  // start periodic health status logging (every 5 minutes)
  setInterval(async () => {
    await healthMonitor.logHealthStatus();
  }, 300000);

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

  // stop health server
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

    // log all startup info together before enhanced logging
    if (botConfigs.length > 0) {
      console.log(tl.foundConfigs + botConfigs.length);
    } else {
      console.warn(tl.noFoundConfigs);
    }

    // register commands for each guild found in database
    for (const config of botConfigs) {
      try {
        await rest.put(Routes.applicationGuildCommands(CLIENT, config.guildId), {
          body: commands,
        });

        console.log(tl.regCmdsSuccess + config.guildId);
      } catch (error) {
        console.error(`${tl.regCmdsFail}${config.guildId}:`, error);
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

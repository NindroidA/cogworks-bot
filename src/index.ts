import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
import 'reflect-metadata';
import { commands } from './commands/commandList';
import { handleSlashCommand } from './commands/commands';
import { handleApplicationInteraction } from './events/applicationInteraction';
import guildCreateEvent from './events/guildCreate';
import guildDeleteEvent from './events/guildDelete';
import messageCreateEvent from './events/messageCreate';
import messageDeleteEvent from './events/messageDelete';
import { handleTicketInteraction } from './events/ticketInteraction';
import { AppDataSource } from './typeorm';
import { BaitChannelConfig } from './typeorm/entities/BaitChannelConfig';
import { BaitChannelLog } from './typeorm/entities/BaitChannelLog';
import { BotConfig } from './typeorm/entities/BotConfig';
import { UserActivity } from './typeorm/entities/UserActivity';
import { enhancedLogger, healthMonitor, healthServer, lang, LogCategory } from './utils';
import { APIConnector } from './utils/apiConnector';
import { BaitChannelManager } from './utils/baitChannelManager';
import { setupGlobalErrorHandlers } from './utils/errorHandler';
import { setDescription, setStatus } from './utils/profileFunctions';
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

let TOKEN = process.env.BOT_TOKEN!;     // default production bot token
let CLIENT = process.env.CLIENT_ID!;    // default production bot client

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
    console.log(lang.main.usingDev);
} else {
    // validate production credentials exist
    if (!process.env.BOT_TOKEN || !process.env.CLIENT_ID) {
        console.error(tl.missingProdCreds);
        console.error(tl.addToEnv);
        process.exit(1);
    }
    console.log(tl.usingProd);
}

// create new discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.MessageContent,
    ],
});

// create new REST client and set bot token
const rest = new REST({ version: '10' }).setToken(TOKEN);

/* init API connector */
const apiConnector = new APIConnector(
    process.env.API_URL || 'http://localhost:3001', // default to localhost and port 3001 if not set
    TOKEN // bot token for authentication
);

// listen for interactions
client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand()) {
        client.emit('chatInputCommand', client, interaction);
    } else if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
        client.emit('buttonInteraction', client, interaction);
    }
});

// register event handlers
client.on('chatInputCommand', handleSlashCommand); // handle when slash commands are sent
client.on('buttonInteraction', handleTicketInteraction); // handle ticket interaction button presses
client.on('buttonInteraction', handleApplicationInteraction); // handle application interaction button presses

// register message events
client.on(messageCreateEvent.name, (message) => messageCreateEvent.execute(message, client));
client.on(messageDeleteEvent.name, (message) => messageDeleteEvent.execute(message, client));

// register guild lifecycle events
client.on(guildCreateEvent.name, (guild) => guildCreateEvent.execute(guild, client));
client.on(guildDeleteEvent.name, (guild) => guildDeleteEvent.execute(guild, client));

// once we reday, LEGGO
client.once('ready', async () => {
	// initialize health monitor first
	healthMonitor.initialize(client);
	
	// THEN initialize health server
	healthServer.initialize(client);
	const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || '3000');
	healthServer.start(HEALTH_PORT);
	
	// log that we logged in
	console.log(tl.ready + `${client.user?.tag}`);
	enhancedLogger.info(
		`Bot started successfully: ${client.user?.tag}`,
		LogCategory.SYSTEM,
		{
			environment: IS_DEV ? 'development' : 'production',
			guilds: client.guilds.cache.size,
			users: client.users.cache.size,
			healthPort: HEALTH_PORT
		}
	);
	
	// log environment info
	console.log(tl.envSeparator);
	console.log(`${tl.envLabel}${IS_DEV ? tl.envDev : tl.envProd}`);
	console.log(`${tl.botLabel}${client.user?.tag}`);
	console.log(`${tl.clientIdLabel}${CLIENT}`);
	console.log(tl.envSeparator);

	// initialize bait channel manager
	const baitChannelManager = new BaitChannelManager(
		client,
		AppDataSource.getRepository(BaitChannelConfig),
		AppDataSource.getRepository(BaitChannelLog),
		AppDataSource.getRepository(UserActivity)
	);

	// attach to client for access in events and commands
	(client as typeof client & { baitChannelManager: BaitChannelManager }).baitChannelManager = baitChannelManager;
	console.log(tl.baitChannelInit);
	enhancedLogger.info('Bait channel manager initialized', LogCategory.SYSTEM);

    // set bot profile customizations (with dev mode indicator)
	setDescription(client, IS_DEV);
    setStatus(client, IS_DEV);

    // connect to API server (skip in dev mode)
    if (!IS_DEV) {
        try {
            await apiConnector.registerBot(client);
            console.log(tl.apiConnected);
            enhancedLogger.info('Connected to API server successfully', LogCategory.API);
            
            apiConnector.startStatsSync(client);
        } catch (error) {
            console.error(tl.apiConnectFailed);
            console.warn(tl.apiContinueWarning);
            enhancedLogger.error(
                'Failed to connect to API server, continuing without it',
                error as Error,
                LogCategory.API
            );
        }
    } else {
        console.log(tl.apiSkipDev);
        enhancedLogger.info(tl.apiSkipDev, LogCategory.SYSTEM);
    }

    // start periodic health status logging (every 5 minutes)
    setInterval(async () => {
        await healthMonitor.logHealthStatus();
    }, 300000);
    
    enhancedLogger.info(
        'Periodic health monitoring started (5 minute intervals)',
        LogCategory.SYSTEM
    );

    // just a lil line for the console
    console.log(tl.line);
});

// Graceful shutdown handler
async function gracefulShutdown(signal: string) {
    console.log(tl.shuttingDown);
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
                console.error(tl.regCmdsFail + `${config.guildId}:`, error);
            }
        }
        
        // now log everything to enhanced logger after console messages are done
        enhancedLogger.info('Database connection established', LogCategory.DATABASE);
        
        if (botConfigs.length > 0) {
            enhancedLogger.info(
                `Found ${botConfigs.length} guild configurations`,
                LogCategory.SYSTEM,
                { configCount: botConfigs.length }
            );
        } else {
            enhancedLogger.warn('No guild configurations found', LogCategory.SYSTEM);
        }

        enhancedLogger.info(
            'Command registration complete',
            LogCategory.SYSTEM,
            { guildsRegistered: botConfigs.length }
        );
        
        // log in
        await client.login(TOKEN);
        enhancedLogger.info('Bot logged in successfully', LogCategory.SYSTEM);
    } catch(error) {
        // if there's an error on startup, log it, and exit
        console.error(tl.error, error);
        enhancedLogger.critical(
            'Fatal error during bot startup',
            error as Error,
            LogCategory.ERROR
        );
        process.exit(1);
    }
}

// NOW LEGGOOOOOOO
main();
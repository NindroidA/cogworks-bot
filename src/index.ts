import { Client, GatewayIntentBits, REST, RESTPostAPIApplicationCommandsJSONBody, Routes } from 'discord.js';
import dotenv from 'dotenv';
import 'reflect-metadata';
import { addRole } from './commands/builders/addRole';
import { archiveMigration } from './commands/builders/archiveMigration';
import { botSetup } from './commands/builders/botSetup';
//import { cogdeck } from './commands/builders/cogdeck';
import { getRoles } from './commands/builders/getRoles';
import { removeRole } from './commands/builders/removeRole';
import { ticketReply } from './commands/builders/ticketReply';
import { ticketSetup } from './commands/builders/ticketSetup';
import { handleSlashCommand } from './commands/commands';
import { handleTicketInteraction } from './events/ticketInteraction';
import { AppDataSource } from './typeorm';
import { BotConfig } from './typeorm/entities/BotConfig';
import lang from './utils/lang.json';
import { setDescription, setStatus } from './utils/profileFunctions';
dotenv.config();

const RELEASE = process.env.RELEASE!;   // determines which bot we're using
let TOKEN = process.env.BOT_TOKEN!;     // default production bot token
let CLIENT = process.env.CLIENT_ID!;    // default production bot client

// if release is dev, use development bot credentials
if (RELEASE == 'dev') {
    TOKEN = process.env.DEV_BOT_TOKEN!;
    CLIENT = process.env.DEV_CLIENT_ID!;
    // log that we're using the development bot
    console.log(lang.main.usingDev);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.MessageContent,
    ],
});
const rest = new REST({ version: '10' }).setToken(TOKEN); 

/* Slash Commands */
const commands: RESTPostAPIApplicationCommandsJSONBody[] = [
    botSetup,         // bot setup
    addRole,          // add a role
    removeRole,       // remove a role
    getRoles,         // get roles
    ticketSetup,      // ticket setup
    ticketReply,      // ticket reply
    archiveMigration, // archive migration functions
    //cogdeck,          // cogworks card game
];

client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand()) {
        client.emit('chatInputCommand', client, interaction);
    } else if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
        client.emit('buttonInteraction', client, interaction);
    }
});

// when slash commands are sent, handleSlashCommand will run
client.on('chatInputCommand', handleSlashCommand);
// when button is pressed, handleTicketInteraction will run
client.on('buttonInteraction', handleTicketInteraction);

// once we reday, LEGGO
client.once('ready', () => {
    // log that we logged in
    console.log(lang.main.ready + `${client.user?.tag}`);

    // set description
    setDescription(client);

    // set status
    setStatus(client);

    // just a lil line for the console
    console.log(lang.main.line);
});

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
        if (botConfigs.length > 0) {
            console.log(lang.main.foundConfigs + botConfigs.length);
        } else {
            console.warn(lang.main.noFoundConfigs);
        }

        // set for guilds that have registered commands
        //const registeredGuildIds = new Set();

        // register commands for each guild found in database
        for (const config of botConfigs) {
            try { 
                await rest.put(Routes.applicationGuildCommands(CLIENT, config.guildId), {
                    body: commands,
                });
                
                //registeredGuildIds.add(config.guildId);
                console.log(lang.main.regCmdsSuccess + config.guildId);
            } catch (error) {
                console.error(lang.main.regCmdsFail + `${config.guildId}:`, error);
            }
        }

        /*
        // register le commands fallback for guilds we don't have the id for
        await rest.put(Routes.applicationCommands(CLIENT), {
            body: commands,
        });
        */
        
        // log in
        await client.login(TOKEN);
    } catch(error) {
        // log error and exit process
        console.error(lang.main.error, error);
        process.exit(1);
    }
}

main();
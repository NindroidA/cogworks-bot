import { Client, GatewayIntentBits, REST, RESTPostAPIApplicationCommandsJSONBody, Routes } from 'discord.js';
import dotenv from 'dotenv';
import 'reflect-metadata';
import { handleSlashCommand } from './commands/commands';
import { AppDataSource } from './typeorm';
import { handleTicketInteraction } from './events/ticketInteraction';
import { ticketSetup } from './commands/builders/ticketSetup';
import { ticketReply } from './commands/builders/ticketReply';
import { addRole } from './commands/builders/addRole';
import { removeRole } from './commands/builders/removeRole';
import { getRoles } from './commands/builders/getRoles';
dotenv.config();

const GUILD = process.env.GUILD_ID!;    // (want to eventually deprecate this)
const RELEASE = process.env.RELEASE!;   // determines which bot we're using
let TOKEN = process.env.BOT_TOKEN!;     // default production bot token
let CLIENT = process.env.CLIENT_ID!;    // default production bot client

// if release is dev, use development bot credentials
if (RELEASE == 'dev') {
    TOKEN = process.env.DEV_BOT_TOKEN!;
    CLIENT = process.env.DEV_CLIENT_ID!;
    // log that we're using the development bot
    console.log('');
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
    addRole,        // add a role
    removeRole,     // remove a role
    getRoles,       // get roles
    ticketSetup,    // ticket setup
    ticketReply,    // ticket reply
];

client.once('ready', () => {
    console.log(`Logged in as ${client.user?.tag}`);
});

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

// main function to do all the things
async function main() {
    try {
        // remove any 'guild specific' commands we had in place
        // (this will eventually be removed once i'm done doing the things)
        await rest.put(Routes.applicationGuildCommands(CLIENT, GUILD), { 
                body: [], // empty array removes all commands
            });

        // remove any application commands we had in place (refresh it basically)
        await rest.put(Routes.applicationCommands(CLIENT), {
            body: [],
        });

        // register le commands we currently have
        await rest.put(Routes.applicationCommands(CLIENT), {
            body: commands,
        });

        // initialize typeORM shtuff
        await AppDataSource.initialize();
        client.login(TOKEN);
    } catch(err) {
        console.log("Startup Error:", err);
    }
}

main();
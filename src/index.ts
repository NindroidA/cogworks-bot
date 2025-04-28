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
import lang from './utils/lang.json';
import { botSetup } from './commands/builders/botSetup';
import { setStatus } from './utils/setStatus';
dotenv.config();

const RELEASE = process.env.RELEASE!;   // determines which bot we're using
let TOKEN = process.env.BOT_TOKEN!;     // default production bot token
let CLIENT = process.env.CLIENT_ID!;    // default production bot client

// if release is dev, use development bot credentials
if (RELEASE == 'dev') {
    TOKEN = process.env.DEV_BOT_TOKEN!;
    CLIENT = process.env.DEV_CLIENT_ID!;
    // log that we're using the development bot
    console.log(lang.general.usingDev);
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
    botSetup,       // bot setup
    addRole,        // add a role
    removeRole,     // remove a role
    getRoles,       // get roles
    ticketSetup,    // ticket setup
    ticketReply,    // ticket reply
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
    console.log(`Logged in as ${client.user?.tag}`);

    // set status
    setStatus(client);
});

// main function to do all the things
async function main() {
    try {

        /*
        // remove any application commands we had in place (refresh it basically)
        await rest.put(Routes.applicationCommands(CLIENT), {
            body: [],
        });*/

        // register le commands we currently have
        await rest.put(Routes.applicationCommands(CLIENT), {
            body: commands,
        });

        // initialize typeORM shtuff
        await AppDataSource.initialize();

        // log in
        client.login(TOKEN);
    } catch(err) {
        console.log("Startup Error:", err);
    }
}

main();
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

const TOKEN = process.env.BOT_TOKEN!;
const GUILD = process.env.GUILD_ID!;
const CLIENT = process.env.CLIENT_ID!;

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
    // add/remove roles
    addRole,
    removeRole,

    // get roles
    getRoles,

    // ticket setup
    ticketSetup,

    // ticket adminOnly
    // ticket reply 
        // bapple (approve/deny)
    ticketReply,

    // set 'moderator' role
    // set admin role
];

client.once('ready', () => {
    console.log(`Logged in as ${client.user?.tag}`);
});

client.on('interactionCreate', async (interaction) => {
    //if (!interaction.isCommand()) return;
  
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
        await rest.put(Routes.applicationGuildCommands(CLIENT, GUILD), {
            body: commands,
        });
        await AppDataSource.initialize();
        client.login(TOKEN);
    } catch(err) {
        console.log(err);
    }
}

main();
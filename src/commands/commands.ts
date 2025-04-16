import { Client, ChatInputCommandInteraction, CacheType } from "discord.js";
import { ticketSetupHandler } from "./handlers/ticketSetup";
import { ticketReplyHandler } from "./handlers/ticketReply";
import { addRoleHandler } from "./handlers/addRole";
import { removeRoleHandler } from "./handlers/removeRole";
import { getRolesHandler } from "./handlers/getRoles";

export const handleSlashCommand = async(client: Client, interaction: ChatInputCommandInteraction<CacheType>) => {
    const user = interaction.user.username;
    const commandName = interaction.commandName;

    // send a log to le console
    console.log(`User ${user} has issued a command: ${commandName}`);

    switch (commandName) {
        // setup command
        case 'ticket-setup': {
            ticketSetupHandler(client, interaction);
            break;
        }
        case 'ticket-reply': {
            ticketReplyHandler(client, interaction);
            break;
        }
        case 'add-role': {
            addRoleHandler(client, interaction);
            break;
        }
        case 'remove-role': {
            removeRoleHandler(client, interaction);
            break;
        }
        case 'get-roles': {
            getRolesHandler(client, interaction);
            break;
        }
    }
}
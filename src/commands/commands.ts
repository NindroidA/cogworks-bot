import { Client, ChatInputCommandInteraction, CacheType } from "discord.js";
import { ticketSetupHandler } from "./handlers/ticketSetup";
import { ticketReplyHandler } from "./handlers/ticketReply";
import { addRoleHandler } from "./handlers/addRole";
import { removeRoleHandler } from "./handlers/removeRole";
import { getRolesHandler } from "./handlers/getRoles";

export const handleSlashCommand = async(client: Client, interaction: ChatInputCommandInteraction<CacheType>) => {

    switch (interaction.commandName) {
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
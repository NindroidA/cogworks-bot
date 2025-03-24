import { Client, ChatInputCommandInteraction, CacheType } from "discord.js";
import { ticketSetupHandler } from "./handlers/ticketSetup";
import { ticketReplyHandler } from "./handlers/ticketReply";

export const handleTicketCommand = async(client: Client, interaction: ChatInputCommandInteraction<CacheType>) => {

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
    }
}
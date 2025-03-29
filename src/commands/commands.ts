import { Client, ChatInputCommandInteraction, CacheType } from "discord.js";
import { ticketSetupHandler } from "./handlers/ticketSetup";
import { ticketReplyHandler } from "./handlers/ticketReply";
import { botSetupHandler } from "./handlers/botSetup";

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
        case 'bot-setup': {
            console.log('bot-setup command received')
            botSetupHandler(client, interaction);
            break;
        }
    }
}
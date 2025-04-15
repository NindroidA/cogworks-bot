import { Client, ChatInputCommandInteraction, CacheType, TextChannel } from 'discord.js';
import { AppDataSource } from '../../typeorm';
import { Ticket } from "../../typeorm/entities/Ticket";
import lang from "../../utils/lang.json";

const ticketRepo = AppDataSource.getRepository(Ticket);

export const ticketReplyHandler = async(client: Client, interaction: ChatInputCommandInteraction<CacheType>) => {
    const subcommandGroup = interaction.options.getSubcommandGroup();
    const subcommand = interaction.options.getSubcommand();

    const channelId = interaction.channelId;
    const channel = interaction.channel as TextChannel;
    
    // check if the command was run in a ticket
    const ticket = await ticketRepo.findOneBy({ channelId: channelId });
    if (!ticket) {
        await interaction.reply({
            content: lang.general.cmdTicketNotFound,
            ephemeral: true, 
        });
        return console.log('Ticket not Found!'); 
    }

    const ticketUser = ticket.createdBy;
    switch (subcommandGroup) {
        // replies for ban appeals
        case 'bapple': {
            if (subcommand == 'approve') { 
                await channel.send(`<@${ticketUser}>` + ", " + lang.ticketReply.bapple.approve);
                await interaction.reply({
                    content: lang.ticketReply.bapple.approveSent,
                    ephemeral: true
                });
            } 
            else if (subcommand == 'deny') { 
                await channel.send(`<@${ticketUser}>` + ", " + lang.ticketReply.bapple.deny);
                await interaction.reply({
                    content: lang.ticketReply.bapple.denySent,
                    ephemeral: true
                }); 
            }
        }
    }
}
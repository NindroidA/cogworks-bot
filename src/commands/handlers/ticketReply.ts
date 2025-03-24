import { Client, ChatInputCommandInteraction, CacheType, TextChannel } from 'discord.js';
import { AppDataSource } from '../../typeorm';
import { Ticket } from "../../typeorm/entities/Ticket";
import dotenv from 'dotenv';
dotenv.config();

const bappleApprove = process.env.BAPPLE_APPROVE!;
const bappleDeny = process.env.BAPPLE_DENY!;

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
            content: 'This command can only be used in a ticket!',
            ephemeral: true, 
        });
        return console.log('Ticket not Found!'); 
    }

    const ticketUser = ticket.createdBy;
    switch (subcommandGroup) {
        // replies for ban appeals
        case 'bapple': {
            if (subcommand == 'approve') { 
                await channel.send(`<@${ticketUser}>` + ", " + bappleApprove);
                await interaction.reply({
                    content: 'Approve message sent!',
                    ephemeral: true
                });
            } 
            else if (subcommand == 'deny') { 
                await channel.send(`<@${ticketUser}>` + ", " + bappleDeny);
                await interaction.reply({
                    content: 'Deny message sent!',
                    ephemeral: true
                }); 
            }
        }
    }
}
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, TextChannel, ChatInputCommandInteraction, CacheType, ForumChannel } from "discord.js";
import { AppDataSource } from "../../typeorm";
import { TicketConfig } from "../../typeorm/entities/TicketConfig";
import { ArchivedTicketConfig } from "../../typeorm/entities/ArchivedTicketConfig";

const ticketConfigRepo = AppDataSource.getRepository(TicketConfig);
const archivedTicketConfigRepo = AppDataSource.getRepository(ArchivedTicketConfig);

export const ticketSetupHandler = async(client: Client, interaction: ChatInputCommandInteraction<CacheType>) => {
    const subCommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId || '';
    const ticketConfig = await ticketConfigRepo.findOneBy({ guildId });
    const archivedTicketConfig = await archivedTicketConfigRepo.findOneBy({ guildId });

    /* CHANNEL SUBCOMMAND */
    if (subCommand == 'channel') {
        // create ticket button
        const row = new ActionRowBuilder<ButtonBuilder>().setComponents(
            new ButtonBuilder()
                .setCustomId('create_ticket')
                .setEmoji('🎫')
                .setLabel('Create Ticket')
                .setStyle(ButtonStyle.Primary),
        );

        const channel = interaction.options.getChannel('channel') as TextChannel;
        
        const mainMsg = {
            content: 'Need help? Press the button below to create a ticket!',
            components: [row],
        }
        
        // make sure the channel exists
        if (!channel) {
            await interaction.reply({
                content: 'The selected channel was not found.',
                ephemeral: true,
            });
            return;
        }
        
        try {
            // if we don't have a ticket config
            if (!ticketConfig) {
                // send main message to the designated channel
                const msg = await channel.send(mainMsg);

                // make a new config containing guild id, main message id, and channel id
                const newTicketConfig = ticketConfigRepo.create({
                    guildId,
                    messageId: msg.id,
                    channelId: channel.id,
                });
                
                // save the new config
                await ticketConfigRepo.save(newTicketConfig);

                // after completion, send an ephemeral success message
                await interaction.reply({
                    content: `The setup message was sent in ${channel}`,
                    ephemeral: true,
                });

            // if we DO have a ticket config    
            } else {
                // send main message to designated channel
                const msg = await channel.send(mainMsg);

                // update the config channelId and messageId and save
                ticketConfig.channelId = channel.id;
                ticketConfig.messageId = msg.id;
                await ticketConfigRepo.save(ticketConfig);

                // after completion, send an ephemeral success message
                await interaction.reply({
                    content: `The setup channel was updated to ${channel}`,
                    ephemeral: true,
                });
            }
        } catch (error) {
            console.error('Failed to setup Ticket Channel:', error);
            await interaction.reply({
                content: 'Setup failed!',
                ephemeral: true,
            });
        }

    /* ARCHIVE SUBCOMMAND */    
    } else if (subCommand == 'archive') {
        const channel = interaction.options.getChannel('channel') as ForumChannel

        // make sure the channel exists
        if (!channel) {
            await interaction.reply({
                content: 'The selected channel was not found.',
                ephemeral: true,
            });
            return;
        }

        try {
            // if we don't have an archived ticket config
            if (!archivedTicketConfig) {
                // send main message to designated channel and pin it
                const msg = await channel.threads.create({
                    name: 'Ticket Archive',
                    message: {
                        content: 'This channel has been made as an archive for tickets. Once a ticket is closed, you it can be found and referenced again in this channel.'
                    },
                });
                msg.pin();

                // make a new config containing the guildId, main message id, and channel id
                const newArchivedTicketConfig = archivedTicketConfigRepo.create({
                    guildId,
                    messageId: msg.id,
                    channelId: channel.id,
                });

                // save the new config
                await archivedTicketConfigRepo.save(newArchivedTicketConfig);

                // after completion, send an ephemeral success message
                await interaction.reply({
                    content: `The setup message was sent in ${channel}`,
                    ephemeral: true,
                });
            } else {
                // send main message to designated channel
                const msg = await channel.threads.create({
                    name: 'Ticket Archive',
                    message: {
                        content: 'This channel has been made as an archive for tickets. Once a ticket is closed, you it can be found and referenced again in this channel.'
                    },
                });
                msg.pin();

                // update the config channelId and messageId and save
                archivedTicketConfig.channelId = channel.id;
                archivedTicketConfig.messageId = msg.id;
                await archivedTicketConfigRepo.save(archivedTicketConfig);

                // after completion, send an ephemeral success message
                await interaction.reply({
                    content: `The setup channel was updated to ${channel}`,
                    ephemeral: true,
                });
            }
        } catch (error) {
            console.error('Failed to setup Ticket Archive Channel:', error);
            await interaction.reply({
                content: 'Setup failed!',
                ephemeral: true,
            });
        }
    }
}
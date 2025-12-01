import { ActionRowBuilder, ButtonBuilder, ButtonStyle, CacheType, CategoryChannel, ChatInputCommandInteraction, Client, ForumChannel, MessageFlags, TextChannel } from 'discord.js';
import { AppDataSource } from '../../typeorm';
import { ArchivedTicketConfig } from '../../typeorm/entities/ticket/ArchivedTicketConfig';
import { TicketConfig } from '../../typeorm/entities/ticket/TicketConfig';
import { createRateLimitKey, lang, LANGF, logger, rateLimiter, RateLimits, requireAdmin } from '../../utils';

const tl = lang.ticketSetup;
const ticketConfigRepo = AppDataSource.getRepository(TicketConfig);
const archivedTicketConfigRepo = AppDataSource.getRepository(ArchivedTicketConfig);

export const ticketSetupHandler = async(client: Client, interaction: ChatInputCommandInteraction<CacheType>) => {
    // Require admin permissions
    if (!await requireAdmin(interaction)) return;

    // Rate limit check (10 ticket setups per hour per guild)
    const rateLimitKey = createRateLimitKey.guild(interaction.guildId!, 'ticket-setup');
    const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.TICKET_SETUP);
    
    if (!rateCheck.allowed) {
        await interaction.reply({
            content: LANGF(lang.errors.rateLimit, Math.ceil((rateCheck.resetIn || 0) / 60000).toString()),
            flags: [MessageFlags.Ephemeral]
        });
        logger(`Rate limit exceeded for ticket setup in guild ${interaction.guildId}`, 'WARN');
        return;
    }

    const subCommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId || '';
    const ticketConfig = await ticketConfigRepo.findOneBy({ guildId });
    const archivedTicketConfig = await archivedTicketConfigRepo.findOneBy({ guildId });

    /* CHANNEL SUBCOMMAND */
    if (subCommand == 'channel') {
        // create ticket button
        const createTicketButton = new ActionRowBuilder<ButtonBuilder>().setComponents(
            new ButtonBuilder()
                .setCustomId('create_ticket')
                .setEmoji('🎫')
                .setLabel('Create Ticket')
                .setStyle(ButtonStyle.Primary),
        );

        const channel = interaction.options.getChannel('channel') as TextChannel;
        
        const mainMsg = {
            content: tl.createTicket,
            components: [createTicketButton],
        };
        
        // make sure the channel exists
        if (!channel) {
            await interaction.reply({
                content: lang.general.channelNotFound,
                flags: [MessageFlags.Ephemeral],
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
                    content: tl.successSet + `${channel}`,
                    flags: [MessageFlags.Ephemeral],
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
                    content: tl.successUpdate + `${channel}`,
                    flags: [MessageFlags.Ephemeral],
                });
            }
        } catch (error) {
            logger(tl.fail + error, 'ERROR');
            await interaction.reply({
                content: tl.fail,
                flags: [MessageFlags.Ephemeral],
            });
        }

    /* CATEGORY SUBCOMMAND */
    } else if (subCommand == 'category') {
        const tlC = lang.categorySetup;
        const category = interaction.options.getChannel('category') as CategoryChannel;
        const categoryId = category.id;

        try {
            // check to make sure we have a ticket config
            if (!ticketConfig) {
                await interaction.reply({
                    content: tlC.setChannelFirst,
                    flags: [MessageFlags.Ephemeral],
                });
                return;
            }

            // save the categoryId to the ticket config
            ticketConfig.categoryId = categoryId;
            ticketConfigRepo.save(ticketConfig);

            await interaction.reply({
                content: tlC.success,
                flags: [MessageFlags.Ephemeral],
            });

        } catch (error) {
            logger(tlC.fail + error, 'ERROR');
            await interaction.reply({
                content: tlC.fail,
                flags: [MessageFlags.Ephemeral],
            });

        }

    /* ARCHIVE SUBCOMMAND */    
    } else if (subCommand == 'archive') {
        const tlA = lang.archiveSetup;
        const channel = interaction.options.getChannel('channel') as ForumChannel;

        // make sure the channel exists
        if (!channel) {
            await interaction.reply({
                content: lang.general.channelNotFound,
                flags: [MessageFlags.Ephemeral],
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
                        content: tlA.initialMsg
                    },
                });
                
                // Try to pin, but don't fail if max pins reached
                try {
                    await msg.pin();
                } catch {
                    logger('Could not pin thread (max pins may be reached)', 'WARN');
                }

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
                    content: tl.successSet + `${channel}`,
                    flags: [MessageFlags.Ephemeral],
                });
            } else {
                // send main message to designated channel
                const msg = await channel.threads.create({
                    name: 'Ticket Archive',
                    message: {
                        content: tlA.initialMsg
                    },
                });
                
                // Try to pin, but don't fail if max pins reached
                try {
                    await msg.pin();
                } catch {
                    logger('Could not pin thread (max pins may be reached)', 'WARN');
                }

                // update the config channelId and messageId and save
                archivedTicketConfig.channelId = channel.id;
                archivedTicketConfig.messageId = msg.id;
                await archivedTicketConfigRepo.save(archivedTicketConfig);

                // after completion, send an ephemeral success message
                await interaction.reply({
                    content: tl.successUpdate + ` ${channel}`,
                    flags: [MessageFlags.Ephemeral],
                });
            }
        } catch (error) {
            logger(tlA.fail + error, 'ERROR');
            await interaction.reply({
                content: tlA.fail,
                flags: [MessageFlags.Ephemeral],
            });
        }
    }
};
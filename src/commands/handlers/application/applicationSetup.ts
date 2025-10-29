import { CacheType, CategoryChannel, ChatInputCommandInteraction, Client, ForumChannel, TextChannel, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { ApplicationConfig } from '../../../typeorm/entities/application/ApplicationConfig';
import { ArchivedApplicationConfig } from '../../../typeorm/entities/application/ArchivedApplicationConfig';
import { Position } from '../../../typeorm/entities/application/Position';
import { lang, logger, requireAdmin } from '../../../utils';
import { buildApplicationMessage } from './applicationPosition';

const applicationConfigRepo = AppDataSource.getRepository(ApplicationConfig);
const archivedApplicationConfigRepo = AppDataSource.getRepository(ArchivedApplicationConfig);
const positionRepo = AppDataSource.getRepository(Position);

export const applicationSetupHandler = async(client: Client, interaction: ChatInputCommandInteraction<CacheType>) => {
    // Require admin permissions
    if (!await requireAdmin(interaction)) return;

    const tl = lang.application.setup;
    const subCommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId || '';
    const applicationConfig = await applicationConfigRepo.findOneBy({ guildId });
    const archivedApplicationConfig = await archivedApplicationConfigRepo.findOneBy({ guildId });

    /* Channel Subcommand */
    if (subCommand === 'channel') {
        const channel = interaction.options.getChannel('channel') as TextChannel;

        // make sure channel exists
        if (!channel) {
            await interaction.reply({
                content: lang.general.channelNotFound,
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        try {
            // get active positions for guild
            const activePositions = await positionRepo.find({
                where: { guildId, isActive: true },
                order: { displayOrder: 'ASC' }
            });

            // build message content and components
            const { content, components } = await buildApplicationMessage(activePositions);

            // if we don't have an application config
            if (!applicationConfig) {
                // send message to designated channel
                const msg = await channel.send({
                    content,
                    components
                });

                // make a new config containing guild id, message id, and channel id
                const newApplicationConfig = applicationConfigRepo.create({
                    guildId,
                    messageId: msg.id,
                    channelId: channel.id
                });

                // save new config
                await applicationConfigRepo.save(newApplicationConfig);

                // send success message
                await interaction.reply({
                    content: tl.successSet + `${channel}`,
                    flags: [MessageFlags.Ephemeral]
                });

            // if we DO have an application config
            } else {
                // send message to designated channel
                const msg = await channel.send({
                    content,
                    components
                });

                // update the config channelId and messageId and save
                applicationConfig.channelId = channel.id;
                applicationConfig.messageId = msg.id;
                await applicationConfigRepo.save(applicationConfig);

                // send success message
                await interaction.reply({
                    content: tl.successUpdate + `${channel}`,
                    flags: [MessageFlags.Ephemeral]
                });
            }

        } catch (error) {
            logger(tl.fail + error, 'ERROR');
            await interaction.reply({
                content: tl.fail,
                flags: [MessageFlags.Ephemeral]
            });
        }

    /* Category Subcommand */
    } else if (subCommand === 'category') {
        const tl = lang.application.categorySetup;
        const category = interaction.options.getChannel('category') as CategoryChannel;
        const categoryId = category.id;

        try {
            // check to make sure we have an application config
            if (!applicationConfig) {
                await interaction.reply({
                    content: tl.setChannelFirst,
                    flags: [MessageFlags.Ephemeral],
                });
                return;
            }

            // save the category id to the application config
            applicationConfig.categoryId = categoryId;
            applicationConfigRepo.save(applicationConfig);

            await interaction.reply({
                content: tl.success,
                flags: [MessageFlags.Ephemeral],
            });

        } catch (error) {
            logger(tl.fail + error, 'ERROR');
            await interaction.reply({
                content: tl.fail,
                flags: [MessageFlags.Ephemeral],
            });
        }

    /* Archive Subcommand */
    } else if (subCommand === 'archive') {
        const tl = lang.application.archiveSetup;
        const channel = interaction.options.getChannel('channel') as ForumChannel;

        // make sure channel exists
        if (!channel) {
            await interaction.reply({
                content: lang.general.channelNotFound,
                flags: [MessageFlags.Ephemeral],
            });
            return;
        }

        try {
            // if we don't have archive application config
            if (!archivedApplicationConfig) {
                // send main message to designated channel and pin it
                const msg = await channel.threads.create({
                    name: 'Application Archive',
                    message: {
                        content: tl.initialMsg
                    }
                });
                
                // Try to pin, but don't fail if max pins reached
                try {
                    await msg.pin();
                } catch {
                    logger('Could not pin thread (max pins may be reached)', 'WARN');
                }

                // make new config with necessary fields
                const newArchivedApplicationConfig = archivedApplicationConfigRepo.create({
                    guildId,
                    messageId: msg.id,
                    channelId: channel.id
                });

                // save new config
                await archivedApplicationConfigRepo.save(newArchivedApplicationConfig);

                // send success message
                await interaction.reply({
                    content: tl.successSet + channel,
                    flags: [MessageFlags.Ephemeral]
                });

            // if we DO have an archive application config
            } else {
                // send main message to designated channel
                const msg = await channel.threads.create({
                    name: 'Application Archive',
                    message: {
                        content: tl.initialMsg
                    }
                });
                
                // Try to pin, but don't fail if max pins reached
                try {
                    await msg.pin();
                } catch {
                    logger('Could not pin thread (max pins may be reached)', 'WARN');
                }

                // update the config
                archivedApplicationConfig.channelId = channel.id;
                archivedApplicationConfig.messageId = msg.id;
                await archivedApplicationConfigRepo.save(archivedApplicationConfig);
                
                // send success message
                await interaction.reply({
                    content: tl.successUpdate + channel,
                    flags: [MessageFlags.Ephemeral]
                });
            }
        } catch (error) {
            logger(tl.fail + error, 'ERROR');
            await interaction.reply({
                content: tl.fail,
                flags: [MessageFlags.Ephemeral]
            });
        }
    }
};
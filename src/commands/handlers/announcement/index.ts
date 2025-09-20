import { CacheType, ChatInputCommandInteraction, Client, NewsChannel, TextChannel } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { AnnouncementConfig } from '../../../typeorm/entities/announcement/AnnouncementConfig';
import { AnnouncementLog } from '../../../typeorm/entities/announcement/AnnouncementLog';
import { lang, LANGF, logger, parseTimeInput } from '../../../utils';

const announcementConfigRepo = AppDataSource.getRepository(AnnouncementConfig);
const announcementLogRepo = AppDataSource.getRepository(AnnouncementLog);

export const announcementHandler = async(client: Client, interaction: ChatInputCommandInteraction<CacheType>) => {
    const tl = lang.announcement;
    let tlC;
    const subCommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId || '';
        
    try {
        const config = await announcementConfigRepo.findOneBy({ guildId });
        if (!config) {
            await interaction.reply({
                content: tl.setup.notConfigured,
                ephemeral: true
            });
            return;
        }

        const targetChannel = interaction.options.getChannel('channel') || await client.channels.fetch(config.defaultChannelId);
            
        if (!targetChannel || !(targetChannel instanceof TextChannel || targetChannel instanceof NewsChannel)) {
            await interaction.reply({
                content: tl.setup.invalidChannel,
                ephemeral: true
            });
            return;
        }

        const minecraftRole = `<@&${config.minecraftRoleId}>`;
        let messageContent = '';
        let announcementType = '';

        if (subCommand === 'maintenance') {
            tlC = tl.maintenance;
            const duration = interaction.options.getString('duration', true);
            announcementType = `maintenance_${duration}`;
                    
            if (duration === 'short') {
                messageContent = `${minecraftRole} ` + tlC.duration.short.msg;
            } else {
                messageContent = `${minecraftRole} ` + tlC.duration.long.msg;
            }
        } else if (subCommand === 'maintenance-scheduled') {
            tlC = tl.maintenance;
            const timeInput = interaction.options.getString('time', true);
            const duration = interaction.options.getString('duration', true);

            // parse time input
            const scheduledTime = parseTimeInput(timeInput);
            if (!scheduledTime) {
                await interaction.reply({
                    content: lang.announcement.invalidTime,
                    ephemeral: true
                });
                return;
            }

            const unixTimestamp = Math.floor(scheduledTime.getTime() / 1000);

            if (duration === 'short') {
                messageContent = LANGF(tlC.scheduled.short, minecraftRole, unixTimestamp);
            } else {
                messageContent = LANGF(tlC.scheduled.long, minecraftRole, unixTimestamp);
            }
        } else if (subCommand === 'back-online') {
            tlC = tl['back-online'];
            announcementType = 'back_online';
            messageContent = `${minecraftRole} ` + tlC.success;

        } else if (subCommand === 'update-scheduled') {
            tlC = tl['update-scheduled'];
            const version = interaction.options.getString('version', true);
            const timeInput = interaction.options.getString('time', true);
                    
            // parse the time input (expecting YYYY-MM-DD HH:MM in Central Time)
            const scheduledTime = parseTimeInput(timeInput);
            if (!scheduledTime) {
                await interaction.reply({
                    content: lang.announcement.invalidTime,
                    ephemeral: true
                });
                return;
            }

            const unixTimestamp = Math.floor(scheduledTime.getTime() / 1000);
            announcementType = 'update_scheduled';
                    
            messageContent = `${minecraftRole} The server will be updating to ${version} later today at approximately <t:${unixTimestamp}:t>. ` + tlC.msg;
        } else if (subCommand === 'update-complete') {
            tlC = tl['update-complete'];
            const completedVersion = interaction.options.getString('version', true);
            announcementType = 'update_complete';
                    
            messageContent = `## Server Update Announcement\n${minecraftRole}\n\nThe server has been successfully updated to **version ${completedVersion}!**\n` + tlC.msg;
        }


        // send the message
        const sentMessage = await targetChannel.send({
            content: messageContent,
            allowedMentions: { roles: [config.minecraftRoleId] }
        });

        // try to publish if it's a news channel
        if (targetChannel instanceof NewsChannel) {
            try {
                await sentMessage.crosspost();
                logger(tl.publish.success + ` ${targetChannel.name}`);
            } catch (publishError) {
                logger(tl.publish.fail + publishError, 'WARN');
            }
        }
        

        // log the announcement
        const newLog = new AnnouncementLog();
        newLog.guildId = guildId;
        newLog.channelId = targetChannel.id;
        newLog.messageId = sentMessage.id;
        newLog.type = announcementType;
        newLog.sentBy = interaction.user.id;

        // handle scheduledTime
        if (subCommand === 'update-scheduled') {
            const parsedTime = parseTimeInput(interaction.options.getString('time', true)!);
            newLog.scheduledTime = parsedTime;
        } else {
            newLog.scheduledTime = null;
        }

        // handle version
        if (['update-scheduled', 'update-complete'].includes(subCommand)) {
            const versionValue = interaction.options.getString('version');
            newLog.version = versionValue;
        } else {
            newLog.version = null;
        }

        await announcementLogRepo.save(newLog);


        await interaction.reply({
            content: tl.success + ` ${targetChannel}`,
            ephemeral: true
        });

        logger(`User ${interaction.user.username} sent ${announcementType} announcement`);

    } catch (error) {
        logger(tl.error + error, 'ERROR');
        await interaction.reply({
            content: tl.fail,
            ephemeral: true
        });
    }
};
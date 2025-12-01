/**
 * Modernized Announcement Handler
 * Features: Template system, preview before sending, embed support
 */

import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    CacheType,
    ChatInputCommandInteraction,
    Client,
    ComponentType,
    EmbedBuilder,
    MessageFlags,
    NewsChannel,
    TextChannel
} from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { AnnouncementConfig } from '../../../typeorm/entities/announcement/AnnouncementConfig';
import { AnnouncementLog } from '../../../typeorm/entities/announcement/AnnouncementLog';
import { createRateLimitKey, lang, LANGF, logger, parseTimeInput, rateLimiter, RateLimits, requireAdmin } from '../../../utils';
import { getTemplate, TemplateParams, validateTemplateParams } from './templates';

const announcementConfigRepo = AppDataSource.getRepository(AnnouncementConfig);
const announcementLogRepo = AppDataSource.getRepository(AnnouncementLog);

/**
 * Main announcement handler with preview functionality
 */
export const announcementHandler = async(
    client: Client,
    interaction: ChatInputCommandInteraction<CacheType>
) => {
    const tl = lang.announcement;
    const tlErr = lang.errors;
    const subCommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId || '';

    try {
        // Permission check - admin only
        const permissionCheck = requireAdmin(interaction);
        if (!permissionCheck.allowed) {
            await interaction.reply({
                content: permissionCheck.message,
                flags: [MessageFlags.Ephemeral]
            });
            logger(`Unauthorized announcement attempt by user ${interaction.user.id} in guild ${guildId}`, 'WARN');
            return;
        }

        // Rate limit check (5 announcements per hour per user)
        const rateLimitKey = createRateLimitKey.user(interaction.user.id, 'announcement-create');
        const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.ANNOUNCEMENT_CREATE);
        
        if (!rateCheck.allowed) {
            await interaction.reply({
                content: LANGF(tlErr.rateLimit, Math.ceil((rateCheck.resetIn || 0) / 60000).toString()),
                flags: [MessageFlags.Ephemeral]
            });
            logger(`Rate limit exceeded for announcement creation by user ${interaction.user.id}`, 'WARN');
            return;
        }

        // Check if announcement module is configured
        const config = await announcementConfigRepo.findOneBy({ guildId });
        if (!config) {
            await interaction.reply({
                content: tl.setup.notConfigured,
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        // Get target channel (from option or use default)
        const targetChannelOption = interaction.options.getChannel('channel');
        const targetChannel = targetChannelOption
            ? targetChannelOption
            : await client.channels.fetch(config.defaultChannelId);

        if (!targetChannel || !(targetChannel instanceof TextChannel || targetChannel instanceof NewsChannel)) {
            await interaction.reply({
                content: tl.setup.invalidChannel,
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        // Build announcement data based on subcommand
        const announcementData = await buildAnnouncementData(interaction, subCommand, config);
        if (!announcementData) return; // Error was already handled

        // Get the template
        const template = getTemplate(announcementData.templateId);
        if (!template) {
            await interaction.reply({
                content: lang.errors.unknownTemplate,
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        // Validate parameters
        const validation = validateTemplateParams(announcementData.templateId, announcementData.params);
        if (!validation.valid) {
            await interaction.reply({
                content: LANGF(lang.errors.invalidParameters, validation.errors.map(e => `• ${e}`).join('\n')),
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        // Build the embed/content
        const mentionRole = `<@&${config.minecraftRoleId}>`;
        const messageData = template.buildEmbed(announcementData.params, mentionRole);

        // Show preview with Send/Cancel buttons
        await showPreview(
            interaction,
            targetChannel,
            messageData,
            announcementData,
            config
        );

    } catch (error) {
        logger(tl.error + error, 'ERROR');
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: tl.fail,
                flags: [MessageFlags.Ephemeral]
            });
        }
    }
};

/**
 * Build announcement data from interaction
 */
async function buildAnnouncementData(
    interaction: ChatInputCommandInteraction<CacheType>,
    subCommand: string,
    _config: AnnouncementConfig
): Promise<{
    templateId: string;
    params: TemplateParams;
    announcementType: string;
    scheduledTime?: Date | null;
    version?: string | null;
} | null> {
    const tl = lang.announcement;

    switch (subCommand) {
        case 'maintenance': {
            const duration = interaction.options.getString('duration', true) as 'short' | 'long';
            return {
                templateId: 'maintenance',
                params: { duration },
                announcementType: `maintenance_${duration}`
            };
        }

        case 'maintenance-scheduled': {
            const timeInput = interaction.options.getString('time', true);
            const duration = interaction.options.getString('duration', true) as 'short' | 'long';

            const scheduledTime = parseTimeInput(timeInput);
            if (!scheduledTime) {
                await interaction.reply({
                    content: tl.invalidTime,
                    flags: [MessageFlags.Ephemeral]
                });
                return null;
            }

            const timestamp = Math.floor(scheduledTime.getTime() / 1000);
            return {
                templateId: 'maintenanceScheduled',
                params: { duration, timestamp },
                announcementType: `maintenance_scheduled_${duration}`,
                scheduledTime
            };
        }

        case 'back-online': {
            return {
                templateId: 'backOnline',
                params: {},
                announcementType: 'back_online'
            };
        }

        case 'update-scheduled': {
            const version = interaction.options.getString('version', true);
            const timeInput = interaction.options.getString('time', true);

            const scheduledTime = parseTimeInput(timeInput);
            if (!scheduledTime) {
                await interaction.reply({
                    content: tl.invalidTime,
                    flags: [MessageFlags.Ephemeral]
                });
                return null;
            }

            const timestamp = Math.floor(scheduledTime.getTime() / 1000);
            return {
                templateId: 'updateScheduled',
                params: { version, timestamp },
                announcementType: 'update_scheduled',
                scheduledTime,
                version
            };
        }

        case 'update-complete': {
            const version = interaction.options.getString('version', true);
            return {
                templateId: 'updateComplete',
                params: { version },
                announcementType: 'update_complete',
                version
            };
        }

        default:
            await interaction.reply({
                content: lang.errors.unknownSubcommand,
                flags: [MessageFlags.Ephemeral]
            });
            return null;
    }
}

/**
 * Show preview of announcement with Send/Cancel buttons
 */
async function showPreview(
    interaction: ChatInputCommandInteraction<CacheType>,
    targetChannel: TextChannel | NewsChannel,
    messageData: { embeds: EmbedBuilder[]; content?: string },
    announcementData: {
        templateId: string;
        params: TemplateParams;
        announcementType: string;
        scheduledTime?: Date | null;
        version?: string | null;
    },
    config: AnnouncementConfig
): Promise<void> {
    const guildId = interaction.guildId || '';

    // Create preview buttons
    const buttons = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('announcement_send')
                .setLabel('📢 Send Announcement')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('announcement_cancel')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
        );

    // Send preview
    await interaction.reply({
        content: `**📋 Preview** (will be sent to ${targetChannel})\n━━━━━━━━━━━━━━━━━━`,
        embeds: messageData.embeds,
        components: [buttons],
        flags: [MessageFlags.Ephemeral]
    });

    // Wait for button click (2 minutes timeout)
    try {
        const buttonInteraction = await interaction.channel?.awaitMessageComponent({
            filter: (i: ButtonInteraction) =>
                i.user.id === interaction.user.id &&
                (i.customId === 'announcement_send' || i.customId === 'announcement_cancel'),
            componentType: ComponentType.Button,
            time: 120000 // 2 minutes
        });

        if (!buttonInteraction) return;

        if (buttonInteraction.customId === 'announcement_cancel') {
            await buttonInteraction.update({
                content: lang.errors.cancelled,
                embeds: [],
                components: []
            });
            return;
        }

        // Send the announcement
        await buttonInteraction.deferUpdate();

        const sentMessage = await targetChannel.send({
            content: messageData.content,
            embeds: messageData.embeds,
            allowedMentions: { roles: [config.minecraftRoleId] }
        });

        // Try to publish if it's a news channel
        if (targetChannel instanceof NewsChannel) {
            try {
                await sentMessage.crosspost();
                logger(lang.announcement.publish.success + ` ${targetChannel.name}`);
            } catch (publishError) {
                logger(lang.announcement.publish.fail + publishError, 'WARN');
            }
        }

        // Log the announcement
        const newLog = new AnnouncementLog();
        newLog.guildId = guildId;
        newLog.channelId = targetChannel.id;
        newLog.messageId = sentMessage.id;
        newLog.type = announcementData.announcementType;
        newLog.sentBy = interaction.user.id;
        newLog.scheduledTime = announcementData.scheduledTime || null;
        newLog.version = announcementData.version || null;

        await announcementLogRepo.save(newLog);

        // Update preview with success message
        await buttonInteraction.editReply({
            content: `✅ Announcement sent to ${targetChannel}!`,
            embeds: [],
            components: []
        });

        logger(`User ${interaction.user.username} sent ${announcementData.announcementType} announcement`);

    } catch (error) {
        // Timeout or error
        logger('Announcement preview timed out or error occurred: ' + error, 'WARN');
    }
}

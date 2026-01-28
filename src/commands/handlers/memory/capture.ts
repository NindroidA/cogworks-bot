import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChatInputCommandInteraction,
    EmbedBuilder,
    ForumChannel,
    Message,
    MessageComponentInteraction,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
    TextChannel,
    TextInputBuilder,
    TextInputStyle
} from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { MemoryConfig, MemoryItem, MemoryTag } from '../../../typeorm/entities/memory';
import {
    Colors,
    E,
    lang,
    requireAdmin,
    enhancedLogger,
    LogCategory,
    healthMonitor,
    rateLimiter,
    createRateLimitKey,
    RateLimits
} from '../../../utils';

const tl = lang.memory;
const memoryConfigRepo = AppDataSource.getRepository(MemoryConfig);
const memoryTagRepo = AppDataSource.getRepository(MemoryTag);
const memoryItemRepo = AppDataSource.getRepository(MemoryItem);

// Regex to extract message link components
const MESSAGE_LINK_REGEX = /https:\/\/(?:ptb\.|canary\.)?discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/;

export const memoryCaptureHandler = async (interaction: ChatInputCommandInteraction) => {
    const startTime = Date.now();
    const adminCheck = requireAdmin(interaction);
    if (!adminCheck.allowed) {
        await interaction.reply({ content: adminCheck.message, flags: [MessageFlags.Ephemeral] });
        return;
    }

    const guildId = interaction.guildId!;
    const userId = interaction.user.id;

    // Rate limit check
    const rateLimitKey = createRateLimitKey.userGuild(userId, guildId, 'memory-capture');
    const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.MEMORY_OPERATION);
    if (!rateCheck.allowed) {
        await interaction.reply({ content: rateCheck.message!, flags: [MessageFlags.Ephemeral] });
        healthMonitor.recordCommand('memory capture', Date.now() - startTime, true);
        return;
    }

    const messageLink = interaction.options.getString('message_link');

    // Check if memory system is configured
    const config = await memoryConfigRepo.findOneBy({ guildId });
    if (!config) {
        await interaction.reply({
            content: `${E.error} ${tl.errors.notConfigured}`,
            flags: [MessageFlags.Ephemeral]
        });
        return;
    }

    // Get the message to capture
    let targetMessage: Message | null = null;
    let sourceChannelId: string | null = null;
    let sourceMessageId: string | null = null;

    if (messageLink) {
        // Parse message link
        const match = messageLink.match(MESSAGE_LINK_REGEX);
        if (!match) {
            await interaction.reply({
                content: `${E.error} ${tl.capture.invalidLink}`,
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        const [, linkGuildId, channelId, messageId] = match;

        // Verify it's from the same guild
        if (linkGuildId !== guildId) {
            await interaction.reply({
                content: `${E.error} ${tl.capture.invalidLink}`,
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        try {
            const channel = await interaction.guild!.channels.fetch(channelId);
            if (channel?.isTextBased()) {
                targetMessage = await (channel as TextChannel).messages.fetch(messageId);
                sourceChannelId = channelId;
                sourceMessageId = messageId;
            }
        } catch {
            await interaction.reply({
                content: `${E.error} ${tl.capture.messageNotFound}`,
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }
    } else {
        await interaction.reply({
            content: `${E.error} ${tl.capture.noReplyOrLink}`,
            flags: [MessageFlags.Ephemeral]
        });
        return;
    }

    if (!targetMessage) {
        await interaction.reply({
            content: `${E.error} ${tl.capture.messageNotFound}`,
            flags: [MessageFlags.Ephemeral]
        });
        return;
    }

    // Get available tags for selection
    const categoryTags = await memoryTagRepo.find({ where: { guildId, tagType: 'category' } });
    const statusTags = await memoryTagRepo.find({ where: { guildId, tagType: 'status' } });

    if (categoryTags.length === 0 || statusTags.length === 0) {
        await interaction.reply({
            content: `${E.error} ${tl.add.noTagsConfigured}`,
            flags: [MessageFlags.Ephemeral]
        });
        return;
    }

    const categoryOptions = categoryTags.map(tag => ({
        label: tag.name,
        value: tag.id.toString(),
        emoji: tag.emoji || undefined
    }));

    const statusOptions = statusTags.map(tag => ({
        label: tag.name,
        value: tag.id.toString(),
        emoji: tag.emoji || undefined
    }));

    const defaultStatus = statusTags.find(t => t.name === 'Open') || statusTags[0];

    // Store selection state
    const selectionState: {
        categoryId: string | null;
        categoryName: string | null;
        statusId: string;
        statusName: string;
        messageContent: string;
        sourceChannelId: string | null;
        sourceMessageId: string | null;
    } = {
        categoryId: null,
        categoryName: null,
        statusId: defaultStatus.id.toString(),
        statusName: defaultStatus.emoji ? `${defaultStatus.emoji} ${defaultStatus.name}` : defaultStatus.name,
        messageContent: targetMessage.content.slice(0, 4000),
        sourceChannelId,
        sourceMessageId
    };

    // Show message preview
    const preview = targetMessage.content.length > 200
        ? targetMessage.content.slice(0, 200) + '...'
        : targetMessage.content;

    // Build initial embed showing current selections
    const buildEmbed = () => {
        return new EmbedBuilder()
            .setTitle(`${E.memory} Capture Message`)
            .setDescription(`**Capturing:**\n> ${preview}`)
            .setColor(Colors.brand.primary)
            .addFields(
                {
                    name: 'Category',
                    value: selectionState.categoryName || '*(not selected)*',
                    inline: true
                },
                {
                    name: 'Status',
                    value: selectionState.statusName || '*(not selected)*',
                    inline: true
                }
            );
    };

    const categorySelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('memory_capture_category')
            .setPlaceholder(tl.add.selectCategory)
            .addOptions(categoryOptions)
    );

    const statusSelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('memory_capture_status')
            .setPlaceholder(tl.add.selectStatus)
            .addOptions(statusOptions.map(opt => ({
                ...opt,
                default: opt.value === selectionState.statusId
            })))
    );

    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('memory_capture_continue')
            .setLabel('Continue')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true), // Disabled until category is selected
        new ButtonBuilder()
            .setCustomId('memory_capture_cancel')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
    );

    const response = await interaction.reply({
        embeds: [buildEmbed()],
        components: [categorySelect, statusSelect, buttonRow],
        flags: [MessageFlags.Ephemeral]
    });

    const collector = response.createMessageComponentCollector({
        time: 120000
    });

    collector.on('collect', async (i) => {
        if (i.user.id !== interaction.user.id) {
            await i.reply({ content: lang.errors.notYourInteraction, flags: [MessageFlags.Ephemeral] });
            return;
        }

        if (i.customId === 'memory_capture_cancel') {
            collector.stop('cancelled');
            await i.update({
                content: lang.errors.cancelled,
                embeds: [],
                components: []
            });
            return;
        }

        if (i.customId === 'memory_capture_continue') {
            collector.stop('continue');
            await showCaptureModal(i, selectionState, guildId, config.forumChannelId);
            return;
        }

        if (i.isStringSelectMenu()) {
            const selectInteraction = i as StringSelectMenuInteraction;

            if (selectInteraction.customId === 'memory_capture_category') {
                const selectedTag = categoryTags.find(t => t.id.toString() === selectInteraction.values[0]);
                selectionState.categoryId = selectInteraction.values[0];
                selectionState.categoryName = selectedTag?.emoji
                    ? `${selectedTag.emoji} ${selectedTag.name}`
                    : selectedTag?.name || null;
            } else if (selectInteraction.customId === 'memory_capture_status') {
                const selectedTag = statusTags.find(t => t.id.toString() === selectInteraction.values[0]);
                selectionState.statusId = selectInteraction.values[0];
                selectionState.statusName = selectedTag?.emoji
                    ? `${selectedTag.emoji} ${selectedTag.name}`
                    : selectedTag?.name || 'Unknown';
            }

            // Rebuild components with updated states
            const updatedCategorySelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('memory_capture_category')
                    .setPlaceholder(tl.add.selectCategory)
                    .addOptions(categoryOptions.map(opt => ({
                        ...opt,
                        default: opt.value === selectionState.categoryId
                    })))
            );

            const updatedStatusSelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('memory_capture_status')
                    .setPlaceholder(tl.add.selectStatus)
                    .addOptions(statusOptions.map(opt => ({
                        ...opt,
                        default: opt.value === selectionState.statusId
                    })))
            );

            const updatedButtonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId('memory_capture_continue')
                    .setLabel('Continue')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(!selectionState.categoryId),
                new ButtonBuilder()
                    .setCustomId('memory_capture_cancel')
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Secondary)
            );

            await selectInteraction.update({
                embeds: [buildEmbed()],
                components: [updatedCategorySelect, updatedStatusSelect, updatedButtonRow]
            });
        }
    });

    collector.on('end', (_, reason) => {
        if (reason === 'time') {
            interaction.editReply({
                content: lang.errors.timeout,
                embeds: [],
                components: []
            }).catch(() => {});
        }
    });
};

async function showCaptureModal(
    interaction: MessageComponentInteraction,
    selectionState: {
        categoryId: string | null;
        statusId: string | null;
        categoryName: string | null;
        statusName: string | null;
        messageContent: string;
        sourceChannelId: string | null;
        sourceMessageId: string | null;
    },
    guildId: string,
    forumChannelId: string
) {
    const modal = new ModalBuilder()
        .setCustomId(`memory_capture_modal_${selectionState.categoryId}_${selectionState.statusId}`)
        .setTitle(tl.capture.modalTitle);

    const titleInput = new TextInputBuilder()
        .setCustomId('memory_title')
        .setLabel(tl.capture.titleLabel)
        .setPlaceholder(tl.capture.titlePlaceholder)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);

    const descriptionInput = new TextInputBuilder()
        .setCustomId('memory_description')
        .setLabel(tl.add.descriptionLabel)
        .setPlaceholder(tl.add.descriptionPlaceholder)
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(4000)
        .setValue(selectionState.messageContent);

    modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput)
    );

    await interaction.showModal(modal);

    try {
        const modalSubmit = await interaction.awaitModalSubmit({
            time: 300000,
            filter: (i: ModalSubmitInteraction) => i.customId.startsWith('memory_capture_modal_') && i.user.id === interaction.user.id
        });

        await handleCaptureModalSubmit(modalSubmit, selectionState, guildId, forumChannelId);
    } catch {
        // Modal timed out or was cancelled
    }
}

async function handleCaptureModalSubmit(
    interaction: ModalSubmitInteraction,
    selectionState: {
        categoryId: string | null;
        statusId: string | null;
        categoryName: string | null;
        statusName: string | null;
        sourceChannelId: string | null;
        sourceMessageId: string | null;
    },
    guildId: string,
    forumChannelId: string
) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    try {
        const title = interaction.fields.getTextInputValue('memory_title');
        const description = interaction.fields.getTextInputValue('memory_description');

        // Get the forum channel
        const forum = await interaction.guild!.channels.fetch(forumChannelId) as ForumChannel;
        if (!forum) {
            await interaction.editReply({ content: `${E.error} ${tl.errors.forumNotFound}` });
            return;
        }

        // Get the selected tags (include guildId for security)
        const categoryTag = selectionState.categoryId
            ? await memoryTagRepo.findOneBy({ id: parseInt(selectionState.categoryId), guildId })
            : null;
        const statusTag = selectionState.statusId
            ? await memoryTagRepo.findOneBy({ id: parseInt(selectionState.statusId), guildId })
            : null;

        // Build applied tags array
        const appliedTags: string[] = [];
        if (categoryTag?.discordTagId) appliedTags.push(categoryTag.discordTagId);
        if (statusTag?.discordTagId) appliedTags.push(statusTag.discordTagId);

        // Build formatted content for the forum post
        let content = `**Description:**\n${description}`;

        // Add -# small text footer for source reference
        if (selectionState.sourceChannelId && selectionState.sourceMessageId) {
            const sourceLink = `https://discord.com/channels/${guildId}/${selectionState.sourceChannelId}/${selectionState.sourceMessageId}`;
            content += `\n\n-# ${tl.capture.sourceLabel} <#${selectionState.sourceChannelId}> • [Jump to message](${sourceLink})`;
        } else {
            content += `\n\n-# Captured by ${interaction.user.displayName}`;
        }

        // Create the forum thread
        const thread = await forum.threads.create({
            name: title,
            message: { content },
            appliedTags
        });

        // Save to database
        const memoryItem = memoryItemRepo.create({
            guildId,
            threadId: thread.id,
            title,
            description,
            status: statusTag?.name || 'Open',
            createdBy: interaction.user.id,
            sourceMessageId: selectionState.sourceMessageId || undefined,
            sourceChannelId: selectionState.sourceChannelId || undefined
        });
        await memoryItemRepo.save(memoryItem);

        await interaction.editReply({
            content: `${E.success} ${tl.capture.success}\n${tl.add.viewThread}: <#${thread.id}>`
        });
    } catch (error) {
        enhancedLogger.error(
            `Memory capture error: ${error}`,
            error instanceof Error ? error : undefined,
            LogCategory.COMMAND_EXECUTION,
            { guildId }
        );
        await interaction.editReply({ content: `${E.error} ${tl.capture.error}` });
    }
}

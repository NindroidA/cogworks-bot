import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChatInputCommandInteraction,
    EmbedBuilder,
    ForumChannel,
    MessageComponentInteraction,
    MessageFlags,
    ModalBuilder,
    ModalSubmitInteraction,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
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

export const memoryAddHandler = async (interaction: ChatInputCommandInteraction) => {
    const startTime = Date.now();
    const adminCheck = requireAdmin(interaction);
    if (!adminCheck.allowed) {
        await interaction.reply({ content: adminCheck.message, flags: [MessageFlags.Ephemeral] });
        return;
    }

    const guildId = interaction.guildId!;
    const userId = interaction.user.id;

    // Rate limit check
    const rateLimitKey = createRateLimitKey.userGuild(userId, guildId, 'memory-add');
    const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.MEMORY_OPERATION);
    if (!rateCheck.allowed) {
        await interaction.reply({ content: rateCheck.message!, flags: [MessageFlags.Ephemeral] });
        healthMonitor.recordCommand('memory add', Date.now() - startTime, true);
        return;
    }

    // Check if memory system is configured
    const config = await memoryConfigRepo.findOneBy({ guildId });
    if (!config) {
        await interaction.reply({
            content: `${E.error} ${tl.errors.notConfigured}`,
            flags: [MessageFlags.Ephemeral]
        });
        return;
    }

    // Get available tags for dropdowns
    const categoryTags = await memoryTagRepo.find({ where: { guildId, tagType: 'category' } });
    const statusTags = await memoryTagRepo.find({ where: { guildId, tagType: 'status' } });

    if (categoryTags.length === 0 || statusTags.length === 0) {
        await interaction.reply({
            content: `${E.error} ${tl.add.noTagsConfigured}`,
            flags: [MessageFlags.Ephemeral]
        });
        return;
    }

    // Build category selection menu
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

    // Default selections
    const defaultStatus = statusTags.find(t => t.name === 'Open') || statusTags[0];

    // Store selection state
    const selectionState: {
        categoryId: string | null;
        categoryName: string | null;
        statusId: string;
        statusName: string;
    } = {
        categoryId: null,
        categoryName: null,
        statusId: defaultStatus.id.toString(),
        statusName: defaultStatus.emoji ? `${defaultStatus.emoji} ${defaultStatus.name}` : defaultStatus.name
    };

    // Build initial embed showing current selections
    const buildEmbed = () => {
        return new EmbedBuilder()
            .setTitle(`${E.memory} Add Memory Item`)
            .setDescription('Select a category and status for your new item.')
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
            .setCustomId('memory_add_category')
            .setPlaceholder(tl.add.selectCategory)
            .addOptions(categoryOptions)
    );

    const statusSelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('memory_add_status')
            .setPlaceholder(tl.add.selectStatus)
            .addOptions(statusOptions.map(opt => ({
                ...opt,
                default: opt.value === selectionState.statusId
            })))
    );

    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('memory_add_continue')
            .setLabel('Continue')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true), // Disabled until category is selected
        new ButtonBuilder()
            .setCustomId('memory_add_cancel')
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

        if (i.customId === 'memory_add_cancel') {
            collector.stop('cancelled');
            await i.update({
                content: lang.errors.cancelled,
                embeds: [],
                components: []
            });
            return;
        }

        if (i.customId === 'memory_add_continue') {
            // Show modal
            collector.stop('continue');
            await showAddModal(i, selectionState, guildId, config.forumChannelId);
            return;
        }

        if (i.isStringSelectMenu()) {
            const selectInteraction = i as StringSelectMenuInteraction;

            if (selectInteraction.customId === 'memory_add_category') {
                const selectedTag = categoryTags.find(t => t.id.toString() === selectInteraction.values[0]);
                selectionState.categoryId = selectInteraction.values[0];
                selectionState.categoryName = selectedTag?.emoji
                    ? `${selectedTag.emoji} ${selectedTag.name}`
                    : selectedTag?.name || null;
            } else if (selectInteraction.customId === 'memory_add_status') {
                const selectedTag = statusTags.find(t => t.id.toString() === selectInteraction.values[0]);
                selectionState.statusId = selectInteraction.values[0];
                selectionState.statusName = selectedTag?.emoji
                    ? `${selectedTag.emoji} ${selectedTag.name}`
                    : selectedTag?.name || 'Unknown';
            }

            // Rebuild components with updated states
            const updatedCategorySelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('memory_add_category')
                    .setPlaceholder(tl.add.selectCategory)
                    .addOptions(categoryOptions.map(opt => ({
                        ...opt,
                        default: opt.value === selectionState.categoryId
                    })))
            );

            const updatedStatusSelect = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('memory_add_status')
                    .setPlaceholder(tl.add.selectStatus)
                    .addOptions(statusOptions.map(opt => ({
                        ...opt,
                        default: opt.value === selectionState.statusId
                    })))
            );

            const updatedButtonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId('memory_add_continue')
                    .setLabel('Continue')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(!selectionState.categoryId), // Enable once category selected
                new ButtonBuilder()
                    .setCustomId('memory_add_cancel')
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

async function showAddModal(
    interaction: MessageComponentInteraction,
    selectionState: { categoryId: string | null; statusId: string | null; categoryName: string | null; statusName: string | null },
    guildId: string,
    forumChannelId: string
) {
    const modal = new ModalBuilder()
        .setCustomId(`memory_add_modal_${selectionState.categoryId}_${selectionState.statusId}`)
        .setTitle(tl.add.modalTitle);

    const titleInput = new TextInputBuilder()
        .setCustomId('memory_title')
        .setLabel(tl.add.titleLabel)
        .setPlaceholder(tl.add.titlePlaceholder)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);

    const descriptionInput = new TextInputBuilder()
        .setCustomId('memory_description')
        .setLabel(tl.add.descriptionLabel)
        .setPlaceholder(tl.add.descriptionPlaceholder)
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(4000);

    modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput)
    );

    await interaction.showModal(modal);

    // Wait for modal submission
    try {
        const modalSubmit = await interaction.awaitModalSubmit({
            time: 300000,
            filter: (i: ModalSubmitInteraction) => i.customId.startsWith('memory_add_modal_') && i.user.id === interaction.user.id
        });

        await handleModalSubmit(modalSubmit, selectionState, guildId, forumChannelId);
    } catch {
        // Modal timed out or was cancelled
    }
}

async function handleModalSubmit(
    interaction: ModalSubmitInteraction,
    selectionState: { categoryId: string | null; statusId: string | null; categoryName: string | null; statusName: string | null },
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
        const content = `**Description:**\n${description}\n\n-# Created by ${interaction.user.displayName}`;

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
            createdBy: interaction.user.id
        });
        await memoryItemRepo.save(memoryItem);

        await interaction.editReply({
            content: `${E.success} ${tl.add.success}\n${tl.add.viewThread}: <#${thread.id}>`
        });
    } catch (error) {
        enhancedLogger.error(
            `Memory add error: ${error}`,
            error instanceof Error ? error : undefined,
            LogCategory.COMMAND_EXECUTION,
            { guildId }
        );
        await interaction.editReply({ content: `${E.error} ${tl.add.error}` });
    }
}

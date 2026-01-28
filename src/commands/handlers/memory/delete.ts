import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    ChatInputCommandInteraction,
    MessageFlags,
    ThreadChannel
} from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { MemoryConfig, MemoryItem } from '../../../typeorm/entities/memory';
import {
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
const memoryItemRepo = AppDataSource.getRepository(MemoryItem);

export const memoryDeleteHandler = async (interaction: ChatInputCommandInteraction) => {
    const startTime = Date.now();
    const adminCheck = requireAdmin(interaction);
    if (!adminCheck.allowed) {
        await interaction.reply({ content: adminCheck.message, flags: [MessageFlags.Ephemeral] });
        return;
    }

    const guildId = interaction.guildId!;
    const userId = interaction.user.id;

    // Rate limit check
    const rateLimitKey = createRateLimitKey.userGuild(userId, guildId, 'memory-delete');
    const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.MEMORY_OPERATION);
    if (!rateCheck.allowed) {
        await interaction.reply({ content: rateCheck.message!, flags: [MessageFlags.Ephemeral] });
        healthMonitor.recordCommand('memory delete', Date.now() - startTime, true);
        return;
    }

    const channel = interaction.channel;

    // Check if memory system is configured
    const config = await memoryConfigRepo.findOneBy({ guildId });
    if (!config) {
        await interaction.reply({
            content: `${E.error} ${tl.errors.notConfigured}`,
            flags: [MessageFlags.Ephemeral]
        });
        return;
    }

    // Check if we're in a thread within the memory forum
    if (!channel || channel.type !== ChannelType.PublicThread) {
        await interaction.reply({
            content: `${E.error} ${tl.delete.notAThread}`,
            flags: [MessageFlags.Ephemeral]
        });
        return;
    }

    const threadChannel = channel as ThreadChannel;

    // Check if the parent is the memory forum
    if (threadChannel.parentId !== config.forumChannelId) {
        await interaction.reply({
            content: `${E.error} ${tl.delete.notInForum}`,
            flags: [MessageFlags.Ephemeral]
        });
        return;
    }

    // Check if this is the welcome thread (cannot delete)
    if (config.messageId && threadChannel.id === config.messageId) {
        await interaction.reply({
            content: `${E.error} ${tl.delete.cannotDeleteWelcome}`,
            flags: [MessageFlags.Ephemeral]
        });
        return;
    }

    // Get the memory item from database (optional - thread might exist without DB entry)
    const memoryItem = await memoryItemRepo.findOneBy({ guildId, threadId: threadChannel.id });

    // Show confirmation
    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId('memory_delete_confirm')
            .setLabel('Delete')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('memory_delete_cancel')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
    );

    const response = await interaction.reply({
        content: `${E.warning} ${tl.delete.confirmMessage}\n\n**Thread:** ${threadChannel.name}`,
        components: [buttonRow],
        flags: [MessageFlags.Ephemeral]
    });

    const collector = response.createMessageComponentCollector({
        time: 60000
    });

    collector.on('collect', async (i) => {
        if (i.user.id !== interaction.user.id) {
            await i.reply({ content: lang.errors.notYourInteraction, flags: [MessageFlags.Ephemeral] });
            return;
        }

        if (i.customId === 'memory_delete_cancel') {
            collector.stop('cancelled');
            await i.update({
                content: lang.errors.cancelled,
                components: []
            });
            return;
        }

        if (i.customId === 'memory_delete_confirm') {
            collector.stop('confirmed');

            try {
                // Delete from database if exists
                if (memoryItem) {
                    await memoryItemRepo.remove(memoryItem);
                }

                // Update the reply before deleting the thread
                await i.update({
                    content: `${E.success} ${tl.delete.success}`,
                    components: []
                });

                // Delete the thread
                await threadChannel.delete();
            } catch (error) {
                enhancedLogger.error(
                    `Memory delete error: ${error}`,
                    error instanceof Error ? error : undefined,
                    LogCategory.COMMAND_EXECUTION,
                    { guildId }
                );
                await i.update({
                    content: `${E.error} ${tl.delete.error}`,
                    components: []
                }).catch(() => {});
            }
            return;
        }
    });

    collector.on('end', (_, reason) => {
        if (reason === 'time') {
            interaction.editReply({
                content: lang.errors.timeout,
                components: []
            }).catch(() => {});
        }
    });
};

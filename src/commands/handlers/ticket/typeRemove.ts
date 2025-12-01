import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, ComponentType, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { CustomTicketType } from '../../../typeorm/entities/ticket/CustomTicketType';
import { enhancedLogger, handleInteractionError, lang, LANGF, LogCategory } from '../../../utils';

const tl = lang.ticket.customTypes.typeRemove;

/**
 * Handler for /ticket type-remove command
 * Deletes a custom ticket type with confirmation
 */
export async function typeRemoveHandler(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
        if (!interaction.guild) {
            await interaction.reply({
                content: lang.general.cmdGuildNotFound,
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        const guildId = interaction.guild.id;
        const typeId = interaction.options.getString('type', true);
        const typeRepo = AppDataSource.getRepository(CustomTicketType);

        const ticketType = await typeRepo.findOne({
            where: { guildId, typeId }
        });

        if (!ticketType) {
            await interaction.reply({
                content: tl.notFound,
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        // Create confirmation buttons
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId('confirm_delete')
                .setLabel('Delete')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('cancel_delete')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
        );

        const confirmMessage = LANGF(tl.confirmMessage, ticketType.displayName);

        await interaction.reply({
            content: `**${tl.confirmTitle}**\n\n${confirmMessage}`,
            components: [row],
            flags: [MessageFlags.Ephemeral]
        });

        // Wait for button interaction
        const filter = (i: { user: { id: string } }) => i.user.id === interaction.user.id;
        const collector = interaction.channel?.createMessageComponentCollector({
            filter,
            componentType: ComponentType.Button,
            time: 30000
        });

        collector?.on('collect', async (i) => {
            if (i.customId === 'confirm_delete') {
                try {
                    await typeRepo.remove(ticketType);

                    await i.update({
                        content: LANGF(tl.success, ticketType.displayName),
                        components: []
                    });

                    enhancedLogger.info(
                        `Ticket type deleted: ${ticketType.typeId}`,
                        LogCategory.COMMAND_EXECUTION,
                        { guildId, typeId: ticketType.typeId, userId: interaction.user.id }
                    );
                } catch {
                    await i.update({
                        content: tl.error,
                        components: []
                    });
                }
            } else {
                await i.update({
                    content: tl.cancelled,
                    components: []
                });
            }

            collector.stop();
        });

        collector?.on('end', async (collected) => {
            if (collected.size === 0) {
                try {
                    await interaction.editReply({
                        content: tl.cancelled,
                        components: []
                    });
                } catch {
                    // Interaction may have expired
                }
            }
        });

    } catch (error) {
        await handleInteractionError(interaction, error, 'typeRemoveHandler');
    }
}

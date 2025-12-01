import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { CustomTicketType } from '../../../typeorm/entities/ticket/CustomTicketType';
import { handleInteractionError, lang, LANGF } from '../../../utils';

const tl = lang.ticket.customTypes.typeDefault;

/**
 * Handler for /ticket type-default command
 * Sets the default ticket type for the guild
 */
export async function typeDefaultHandler(interaction: ChatInputCommandInteraction): Promise<void> {
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

        const type = await typeRepo.findOne({
            where: { guildId, typeId }
        });

        if (!type) {
            await interaction.reply({
                content: tl.notFound,
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        if (!type.isActive) {
            await interaction.reply({
                content: tl.mustBeActive,
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        // Remove default flag from all other types
        await typeRepo.update(
            { guildId, isDefault: true },
            { isDefault: false }
        );

        // Set this type as default
        type.isDefault = true;
        await typeRepo.save(type);

        await interaction.reply({
            content: LANGF(tl.success, type.displayName),
            flags: [MessageFlags.Ephemeral]
        });
    } catch (error) {
        await handleInteractionError(interaction, error, 'typeDefaultHandler');
    }
}

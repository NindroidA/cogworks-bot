import { AutocompleteInteraction, ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { CustomTicketType } from '../../../typeorm/entities/ticket/CustomTicketType';
import { handleInteractionError, lang, LANGF } from '../../../utils';

const tl = lang.ticket.customTypes.typeToggle;

/**
 * Handler for /ticket type-toggle command
 * Activates or deactivates a custom ticket type
 */
export async function typeToggleHandler(interaction: ChatInputCommandInteraction): Promise<void> {
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

        // Toggle the active status
        type.isActive = !type.isActive;
        await typeRepo.save(type);

        const message = type.isActive
            ? LANGF(tl.activated, type.displayName)
            : LANGF(tl.deactivated, type.displayName);

        await interaction.reply({
            content: message,
            flags: [MessageFlags.Ephemeral]
        });
    } catch (error) {
        await handleInteractionError(interaction, error, 'typeToggleHandler');
    }
}

/**
 * Autocomplete handler for ticket type selection
 * Used by type-toggle, type-edit, and type-default commands
 */
export async function ticketTypeAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
    try {
        if (!interaction.guild) return;

        const guildId = interaction.guild.id;
        const focusedValue = interaction.options.getFocused().toLowerCase();

        const typeRepo = AppDataSource.getRepository(CustomTicketType);

        const types = await typeRepo.find({
            where: { guildId },
            order: { sortOrder: 'ASC' }
        });

        const filtered = types
            .filter(type =>
                type.typeId.toLowerCase().includes(focusedValue) ||
                type.displayName.toLowerCase().includes(focusedValue)
            )
            .slice(0, 25); // Discord limit

        await interaction.respond(
            filtered.map(type => ({
                name: `${type.emoji || '❓'} ${type.displayName} (${type.isActive ? '🟢' : '🔴'})`,
                value: type.typeId
            }))
        );
    } catch (error) {
        console.error('Autocomplete error:', error);
        // Autocomplete errors should fail silently
        await interaction.respond([]);
    }
}

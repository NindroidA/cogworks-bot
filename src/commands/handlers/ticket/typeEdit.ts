import { ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChatInputCommandInteraction,
    ModalBuilder,
    ModalSubmitInteraction,
    TextInputBuilder,
    TextInputStyle, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { CustomTicketType } from '../../../typeorm/entities/ticket/CustomTicketType';
import { handleInteractionError, lang, logger } from '../../../utils';
import { buildTypeConfirmationEmbed } from './typeAdd';

const tl = lang.ticket.customTypes.typeEdit;

/**
 * Handler for /ticket type-edit command
 * Shows modal for editing an existing custom ticket type
 */
export async function typeEditHandler(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
        const user = interaction.user.username;

        if (!interaction.guild) {
            logger('Type-edit failed: guild not found', 'WARN');
            await interaction.reply({
                content: lang.general.cmdGuildNotFound,
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        const guildId = interaction.guild.id;
        const typeId = interaction.options.getString('type', true);
        logger(`User ${user} opening type-edit modal for '${typeId}'`);

        const typeRepo = AppDataSource.getRepository(CustomTicketType);

        const type = await typeRepo.findOne({
            where: { guildId, typeId }
        });

        if (!type) {
            logger(`User ${user} type-edit failed: type '${typeId}' not found`, 'WARN');
            await interaction.reply({
                content: tl.notFound,
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        // Create modal pre-filled with existing values
        const modal = new ModalBuilder()
            .setCustomId(`ticket-type-edit-modal:${typeId}`)
            .setTitle(tl.modalTitle);

        const displayNameInput = new TextInputBuilder()
            .setCustomId('displayName')
            .setLabel(lang.ticket.customTypes.typeAdd.displayNameLabel)
            .setValue(type.displayName)
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(100);

        const emojiInput = new TextInputBuilder()
            .setCustomId('emoji')
            .setLabel(lang.ticket.customTypes.typeAdd.emojiLabel)
            .setValue(type.emoji || '')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(10);

        const colorInput = new TextInputBuilder()
            .setCustomId('color')
            .setLabel(lang.ticket.customTypes.typeAdd.colorLabel)
            .setValue(type.embedColor)
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(7);

        const descriptionInput = new TextInputBuilder()
            .setCustomId('description')
            .setLabel(lang.ticket.customTypes.typeAdd.descriptionLabel)
            .setValue(type.description || '')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(500);

        const row1 = new ActionRowBuilder<TextInputBuilder>().addComponents(displayNameInput);
        const row2 = new ActionRowBuilder<TextInputBuilder>().addComponents(emojiInput);
        const row3 = new ActionRowBuilder<TextInputBuilder>().addComponents(colorInput);
        const row4 = new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput);

        modal.addComponents(row1, row2, row3, row4);

        await interaction.showModal(modal);
    } catch (error) {
        await handleInteractionError(interaction, error, 'typeEditHandler');
    }
}

/**
 * Handler for ticket type-edit modal submission
 */
export async function typeEditModalHandler(
    interaction: ModalSubmitInteraction,
    typeId: string
): Promise<void> {
    try {
        const user = interaction.user.username;
        logger(`User ${user} submitted type-edit modal for '${typeId}'`);

        if (!interaction.guild) {
            logger('Type-edit modal failed: guild not found', 'WARN');
            await interaction.reply({
                content: lang.general.cmdGuildNotFound,
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        const guildId = interaction.guild.id;

        // Get modal inputs
        const displayName = interaction.fields.getTextInputValue('displayName').trim();
        const emoji = interaction.fields.getTextInputValue('emoji')?.trim() || null;
        const colorInput = interaction.fields.getTextInputValue('color')?.trim() || '#0099ff';
        const description = interaction.fields.getTextInputValue('description')?.trim() || null;

        // Validate hex color
        if (!/^#[0-9A-Fa-f]{6}$/.test(colorInput)) {
            logger(`User ${user} type-edit validation failed: invalid color '${colorInput}'`, 'WARN');
            await interaction.reply({
                content: lang.ticket.customTypes.typeAdd.invalidColor,
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        const typeRepo = AppDataSource.getRepository(CustomTicketType);

        const type = await typeRepo.findOne({
            where: { guildId, typeId }
        });

        if (!type) {
            logger(`User ${user} type-edit modal failed: type '${typeId}' not found`, 'WARN');
            await interaction.reply({
                content: tl.notFound,
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        // Update ticket type
        type.displayName = displayName;
        type.emoji = emoji || null;
        type.embedColor = colorInput;
        type.description = description || null;

        await typeRepo.save(type);
        logger(`User ${user} updated ticket type '${typeId}' (${displayName}) in guild ${guildId}`);

        // Build confirmation embed with type details
        const embed = buildTypeConfirmationEmbed(type, false);

        // Add toggle button for staff ping setting
        const toggleButton = new ButtonBuilder()
            .setCustomId(`ticket_type_ping_toggle:${typeId}`)
            .setLabel(type.pingStaffOnCreate ? lang.ticket.customTypes.typeAdd.pingToggleDisable : lang.ticket.customTypes.typeAdd.pingToggleEnable)
            .setStyle(type.pingStaffOnCreate ? ButtonStyle.Danger : ButtonStyle.Success)
            .setEmoji(type.pingStaffOnCreate ? '🔕' : '🔔');

        const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(toggleButton);

        await interaction.reply({
            embeds: [embed],
            components: [buttonRow],
            flags: [MessageFlags.Ephemeral]
        });
    } catch (error) {
        await handleInteractionError(interaction, error, 'typeEditModalHandler');
    }
}

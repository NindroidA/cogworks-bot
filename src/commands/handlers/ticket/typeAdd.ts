import { ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChatInputCommandInteraction,
    EmbedBuilder,
    ModalBuilder,
    ModalSubmitInteraction,
    TextInputBuilder,
    TextInputStyle, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { CustomTicketType } from '../../../typeorm/entities/ticket/CustomTicketType';
import { E, handleInteractionError, lang, LANGF, logger } from '../../../utils';

const tl = lang.ticket.customTypes.typeAdd;

/**
 * Handler for /ticket type-add command
 * Shows modal for creating a new custom ticket type
 */
export async function typeAddHandler(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
        const user = interaction.user.username;
        logger(`User ${user} opened ticket type-add modal`);

        if (!interaction.guild) {
            logger('Type-add failed: guild not found', 'WARN');
            await interaction.reply({
                content: lang.general.cmdGuildNotFound,
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        // Create modal
        const modal = new ModalBuilder()
            .setCustomId('ticket-type-add-modal')
            .setTitle(tl.modalTitle);

        // Type ID input
        const typeIdInput = new TextInputBuilder()
            .setCustomId('typeId')
            .setLabel(tl.typeIdLabel)
            .setPlaceholder(tl.typeIdPlaceholder)
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(50);

        // Display name input
        const displayNameInput = new TextInputBuilder()
            .setCustomId('displayName')
            .setLabel(tl.displayNameLabel)
            .setPlaceholder(tl.displayNamePlaceholder)
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(100);

        // Emoji input
        const emojiInput = new TextInputBuilder()
            .setCustomId('emoji')
            .setLabel(tl.emojiLabel)
            .setPlaceholder(tl.emojiPlaceholder)
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(10);

        // Color input
        const colorInput = new TextInputBuilder()
            .setCustomId('color')
            .setLabel(tl.colorLabel)
            .setPlaceholder(tl.colorPlaceholder)
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(7);

        // Description input
        const descriptionInput = new TextInputBuilder()
            .setCustomId('description')
            .setLabel(tl.descriptionLabel)
            .setPlaceholder(tl.descriptionPlaceholder)
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(500);

        // Add inputs to action rows
        const row1 = new ActionRowBuilder<TextInputBuilder>().addComponents(typeIdInput);
        const row2 = new ActionRowBuilder<TextInputBuilder>().addComponents(displayNameInput);
        const row3 = new ActionRowBuilder<TextInputBuilder>().addComponents(emojiInput);
        const row4 = new ActionRowBuilder<TextInputBuilder>().addComponents(colorInput);
        const row5 = new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput);

        modal.addComponents(row1, row2, row3, row4, row5);

        await interaction.showModal(modal);
    } catch (error) {
        await handleInteractionError(interaction, error, 'typeAddHandler');
    }
}

/**
 * Handler for ticket type-add modal submission
 */
export async function typeAddModalHandler(interaction: ModalSubmitInteraction): Promise<void> {
    try {
        const user = interaction.user.username;
        logger(`User ${user} submitted ticket type-add modal`);

        if (!interaction.guild) {
            logger('Type-add modal failed: guild not found', 'WARN');
            await interaction.reply({
                content: lang.general.cmdGuildNotFound,
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        const guildId = interaction.guild.id;

        // Get modal inputs
        const typeId = interaction.fields.getTextInputValue('typeId').toLowerCase().trim();
        const displayName = interaction.fields.getTextInputValue('displayName').trim();
        const emoji = interaction.fields.getTextInputValue('emoji')?.trim() || null;
        const colorInput = interaction.fields.getTextInputValue('color')?.trim() || '#0099ff';
        const description = interaction.fields.getTextInputValue('description')?.trim() || null;

        // Validate type ID format (lowercase, numbers, underscores only)
        if (!/^[a-z0-9_]+$/.test(typeId)) {
            logger(`User ${user} type-add validation failed: invalid typeId format '${typeId}'`, 'WARN');
            await interaction.reply({
                content: tl.invalidTypeId,
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        // Validate hex color
        if (!/^#[0-9A-Fa-f]{6}$/.test(colorInput)) {
            logger(`User ${user} type-add validation failed: invalid color '${colorInput}'`, 'WARN');
            await interaction.reply({
                content: tl.invalidColor,
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        const typeRepo = AppDataSource.getRepository(CustomTicketType);

        // Check for duplicate type ID
        const existing = await typeRepo.findOne({
            where: { guildId, typeId }
        });

        if (existing) {
            logger(`User ${user} type-add failed: duplicate typeId '${typeId}'`, 'WARN');
            await interaction.reply({
                content: LANGF(tl.duplicate, typeId),
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        // Get highest sort order
        const types = await typeRepo.find({
            where: { guildId },
            order: { sortOrder: 'DESC' }
        });
        const nextSortOrder = types.length > 0 ? types[0].sortOrder + 1 : 1;

        // Create new ticket type (starts disabled until configured)
        const newType = typeRepo.create({
            guildId,
            typeId,
            displayName,
            emoji: emoji || undefined,
            embedColor: colorInput,
            description: description || undefined,
            isActive: false, // Start disabled until user configures fields
            isDefault: false,
            sortOrder: nextSortOrder
        });

        await typeRepo.save(newType);
        logger(`User ${user} created new ticket type '${typeId}' (${displayName}) in guild ${guildId}`);

        // Build confirmation embed with type details
        const embed = buildTypeConfirmationEmbed(newType, true);

        // Add toggle button for staff ping setting
        const toggleButton = new ButtonBuilder()
            .setCustomId(`ticket_type_ping_toggle:${typeId}`)
            .setLabel(newType.pingStaffOnCreate ? tl.pingToggleDisable : tl.pingToggleEnable)
            .setStyle(newType.pingStaffOnCreate ? ButtonStyle.Danger : ButtonStyle.Success)
            .setEmoji(newType.pingStaffOnCreate ? '🔕' : '🔔');

        const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(toggleButton);

        await interaction.reply({
            embeds: [embed],
            components: [buttonRow],
            flags: [MessageFlags.Ephemeral]
        });
    } catch (error) {
        await handleInteractionError(interaction, error, 'typeAddModalHandler');
    }
}

/**
 * Builds a confirmation embed showing ticket type details
 */
export function buildTypeConfirmationEmbed(type: CustomTicketType, isNew: boolean): EmbedBuilder {
    const tl = lang.ticket.customTypes;
    const title = isNew ? tl.typeAdd.success : tl.typeEdit.success;

    const embed = new EmbedBuilder()
        .setTitle(`${E.ok} ${LANGF(title, type.displayName).replace('!', '')}`)
        .setColor(parseInt(type.embedColor.replace('#', ''), 16))
        .setTimestamp();

    // Type details
    const details = [
        `**${tl.confirmEmbed.typeId}:** \`${type.typeId}\``,
        `**${tl.confirmEmbed.displayName}:** ${type.emoji || ''} ${type.displayName}`,
        `**${tl.confirmEmbed.color}:** ${type.embedColor}`,
        `**${tl.confirmEmbed.status}:** ${type.isActive ? '🟢 Active' : '🔴 Inactive'}`,
        `**${tl.confirmEmbed.pingStaff}:** ${type.pingStaffOnCreate ? '🔔 Enabled' : '🔕 Disabled'}`
    ];

    if (type.description) {
        details.push(`**${tl.confirmEmbed.description}:** ${type.description}`);
    }

    embed.setDescription(details.join('\n'));

    // Add footer with next steps for new types
    if (isNew) {
        embed.setFooter({
            text: `💡 Use /ticket type-fields type:${type.typeId} to configure fields, then /ticket type-toggle to activate.`
        });
    }

    return embed;
}

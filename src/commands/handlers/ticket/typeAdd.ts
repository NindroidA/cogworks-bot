import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  type ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { CustomTicketType } from '../../../typeorm/entities/ticket/CustomTicketType';
import {
  E,
  enhancedLogger,
  formatLang,
  guardFeatureAccess,
  handleInteractionError,
  LogCategory,
  lang,
  replyEphemeralError,
  sanitizeUserInput,
} from '../../../utils';

const tl = lang.ticket.customTypes.typeAdd;

/**
 * Handler for /ticket type-add command
 * Shows modal for creating a new custom ticket type
 */
export async function typeAddHandler(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    const guard = await guardFeatureAccess(interaction, 'tickets', 'manage');
    if (!guard.allowed) return;

    const user = interaction.user.username;
    enhancedLogger.info(`User ${user} opened ticket type-add modal`, LogCategory.COMMAND_EXECUTION);

    // Create modal
    const modal = new ModalBuilder().setCustomId('ticket-type-add-modal').setTitle(tl.modalTitle);

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
    enhancedLogger.info(`User ${user} submitted ticket type-add modal`, LogCategory.COMMAND_EXECUTION);

    const guildId = interaction.guildId!;

    // Get modal inputs
    const typeId = interaction.fields.getTextInputValue('typeId').toLowerCase().trim();
    const displayName = sanitizeUserInput(interaction.fields.getTextInputValue('displayName'));
    const emoji = interaction.fields.getTextInputValue('emoji')?.trim() || null;
    const colorInput = interaction.fields.getTextInputValue('color')?.trim() || '#0099ff';
    const description = sanitizeUserInput(interaction.fields.getTextInputValue('description')) || null;

    // Validate type ID format (lowercase, numbers, underscores only)
    if (!/^[a-z0-9_]+$/.test(typeId)) {
      enhancedLogger.warn(
        `User ${user} type-add validation failed: invalid typeId format '${typeId}'`,
        LogCategory.COMMAND_EXECUTION,
      );
      await replyEphemeralError(interaction, tl.invalidTypeId);
      return;
    }

    // Validate hex color
    if (!/^#[0-9A-Fa-f]{6}$/.test(colorInput)) {
      enhancedLogger.warn(
        `User ${user} type-add validation failed: invalid color '${colorInput}'`,
        LogCategory.COMMAND_EXECUTION,
      );
      await replyEphemeralError(interaction, tl.invalidColor);
      return;
    }

    const typeRepo = AppDataSource.getRepository(CustomTicketType);

    // Check for duplicate type ID
    const existing = await typeRepo.findOne({
      where: { guildId, typeId },
    });

    if (existing) {
      enhancedLogger.warn(`User ${user} type-add failed: duplicate typeId '${typeId}'`, LogCategory.COMMAND_EXECUTION);
      await replyEphemeralError(interaction, formatLang(tl.duplicate, typeId));
      return;
    }

    // Get highest sort order
    const types = await typeRepo.find({
      where: { guildId },
      order: { sortOrder: 'DESC' },
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
      sortOrder: nextSortOrder,
    });

    await typeRepo.save(newType);
    enhancedLogger.info(
      `User ${user} created new ticket type '${typeId}' (${displayName}) in guild ${guildId}`,
      LogCategory.COMMAND_EXECUTION,
    );

    const embed = buildTypeConfirmationEmbed(newType, 'created');
    const buttonRow = buildPostSubmitButtons(newType);

    await interaction.reply({
      embeds: [embed],
      components: [buttonRow],
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, 'typeAddModalHandler');
  }
}

/**
 * Action-row of post-submit toggle buttons used by typeAdd's confirmation
 * reply and by the per-button refresh in `events/ticket/typeAdmin.ts`.
 *  - Activate/Deactivate flips `isActive` (handled by `activeToggleButton`).
 *  - Enable/Disable Staff Ping flips `pingStaffOnCreate` (handled by
 *    `pingToggleButton`).
 * Both handlers rebuild this row after their write so the row's labels +
 * styles always reflect the current state.
 */
export function buildPostSubmitButtons(type: CustomTicketType): ActionRowBuilder<ButtonBuilder> {
  const ta = lang.ticket.customTypes.typeAdd;
  const activeButton = new ButtonBuilder()
    .setCustomId(`ticket_type_active_toggle:${type.typeId}`)
    .setLabel(type.isActive ? 'Deactivate' : 'Activate')
    .setStyle(type.isActive ? ButtonStyle.Danger : ButtonStyle.Success)
    .setEmoji(type.isActive ? '🚫' : '✅');

  const pingButton = new ButtonBuilder()
    .setCustomId(`ticket_type_ping_toggle:${type.typeId}`)
    .setLabel(type.pingStaffOnCreate ? ta.pingToggleDisable : ta.pingToggleEnable)
    .setStyle(type.pingStaffOnCreate ? ButtonStyle.Danger : ButtonStyle.Success)
    .setEmoji(type.pingStaffOnCreate ? '🔕' : '🔔');

  return new ActionRowBuilder<ButtonBuilder>().addComponents(activeButton, pingButton);
}

export type TypeEmbedMode = 'created' | 'updated' | 'viewing';

/**
 * Builds a details embed for a ticket type. Three modes:
 *  - 'created'  → "✅ Ticket type X created" + footer hint with next steps
 *  - 'updated'  → "✅ Ticket type X updated"
 *  - 'viewing'  → just the type's display name (no success verb), used by the
 *                 interactive `/ticket type list` so picking a type to inspect
 *                 doesn't read like the user just edited it.
 */
export function buildTypeConfirmationEmbed(type: CustomTicketType, mode: TypeEmbedMode): EmbedBuilder {
  const tl = lang.ticket.customTypes;
  const title =
    mode === 'created'
      ? `${E.ok} ${formatLang(tl.typeAdd.success, type.displayName).replace('!', '')}`
      : mode === 'updated'
        ? `${E.ok} ${formatLang(tl.typeEdit.success, type.displayName).replace('!', '')}`
        : `${type.emoji ? `${type.emoji} ` : ''}${type.displayName}`;

  const embed = new EmbedBuilder().setTitle(title).setColor(parseInt(type.embedColor.replace('#', ''), 16));

  // Type details
  const details = [
    `**${tl.confirmEmbed.typeId}:** \`${type.typeId}\``,
    `**${tl.confirmEmbed.displayName}:** ${type.emoji || ''} ${type.displayName}`,
    `**${tl.confirmEmbed.color}:** ${type.embedColor}`,
    `**${tl.confirmEmbed.status}:** ${type.isActive ? '🟢 Active' : '🔴 Inactive'}`,
    `**${tl.confirmEmbed.pingStaff}:** ${type.pingStaffOnCreate ? '🔔 Enabled' : '🔕 Disabled'}`,
  ];

  if (type.description) {
    details.push(`**${tl.confirmEmbed.description}:** ${type.description}`);
  }

  embed.setDescription(details.join('\n'));

  // Footer with next steps only for newly created types
  if (mode === 'created') {
    embed.setFooter({
      text: `💡 Use /ticket type-fields type:${type.typeId} to configure fields, then /ticket type-toggle to activate.`,
    });
  }

  return embed;
}

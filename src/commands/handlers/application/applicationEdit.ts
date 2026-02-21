import {
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
  ModalBuilder,
  type ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { Position } from '../../../typeorm/entities/application/Position';
import { enhancedLogger, handleInteractionError, LogCategory, lang } from '../../../utils';
import { updateApplicationMessage } from './applicationPosition';

const pl = lang.application.position;
const positionRepo = AppDataSource.getRepository(Position);

/**
 * Handler for /application position edit command
 * Shows modal for editing an existing position
 */
export async function applicationEditHandler(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  try {
    if (!interaction.guild) {
      await interaction.reply({
        content: lang.general.cmdGuildNotFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const guildId = interaction.guild.id;
    const positionValue = interaction.options.getString('position', true);
    const positionId = parseInt(positionValue, 10);

    const position = await positionRepo.findOne({
      where: { id: positionId, guildId },
    });

    if (!position) {
      await interaction.reply({
        content: pl.edit.notFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Create modal pre-filled with existing values
    const modal = new ModalBuilder()
      .setCustomId(`application-position-edit-modal:${positionId}`)
      .setTitle(pl.edit.title);

    const titleInput = new TextInputBuilder()
      .setCustomId('title')
      .setLabel('Position Title')
      .setValue(position.title)
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(100);

    const descriptionInput = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('Description')
      .setValue(position.description)
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(2000);

    const emojiInput = new TextInputBuilder()
      .setCustomId('emoji')
      .setLabel('Emoji (e.g., 🤝)')
      .setValue(position.emoji || '')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(100);

    const ageGateInput = new TextInputBuilder()
      .setCustomId('age_gate')
      .setLabel('Age Verification? (yes / no)')
      .setValue(position.ageGateEnabled ? 'yes' : 'no')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(5);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(emojiInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(ageGateInput),
    );

    await interaction.showModal(modal);
  } catch (error) {
    await handleInteractionError(interaction, error, 'applicationEditHandler');
  }
}

/**
 * Handler for position edit modal submission
 */
export async function applicationEditModalHandler(
  interaction: ModalSubmitInteraction,
  positionId: number,
): Promise<void> {
  try {
    if (!interaction.guild) {
      await interaction.reply({
        content: lang.general.cmdGuildNotFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const guildId = interaction.guild.id;

    const title = interaction.fields.getTextInputValue('title').trim();
    const description = interaction.fields.getTextInputValue('description')?.trim() || '';
    const emoji = interaction.fields.getTextInputValue('emoji')?.trim() || null;
    const ageGateInput =
      interaction.fields.getTextInputValue('age_gate')?.trim().toLowerCase() || 'no';

    const ageGateEnabled = ageGateInput === 'yes' || ageGateInput === 'true';

    const position = await positionRepo.findOne({
      where: { id: positionId, guildId },
    });

    if (!position) {
      await interaction.reply({
        content: pl.edit.notFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Update position
    position.title = title;
    position.description = description;
    position.emoji = emoji || null;
    position.ageGateEnabled = ageGateEnabled;

    await positionRepo.save(position);

    enhancedLogger.info(
      `Position edited: "${title}" (ID: ${positionId})`,
      LogCategory.COMMAND_EXECUTION,
      {
        userId: interaction.user.id,
        guildId,
        positionId,
      },
    );

    await interaction.reply({
      content: `✅ ${pl.edit.success}\n\n**Title:** ${title}\n**Emoji:** ${emoji || '📝'}\n**Age Gate:** ${ageGateEnabled ? 'Enabled 🔞' : 'Disabled'}`,
      flags: [MessageFlags.Ephemeral],
    });

    // Refresh the application channel
    await updateApplicationMessage(interaction.client, guildId);
  } catch (error) {
    await handleInteractionError(interaction, error, 'applicationEditModalHandler');
  }
}

import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  type ModalSubmitInteraction,
  StringSelectMenuBuilder,
  type StringSelectMenuInteraction,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { Position } from '../../../typeorm/entities/application/Position';
import type { CustomInputField } from '../../../typeorm/entities/shared/CustomInputField';
import { enhancedLogger, handleInteractionError, LogCategory, lang } from '../../../utils';

const pl = lang.application.position;
const fl = lang.application.position.fields;

// Store last attempted field values per user+position (clears after 5 minutes)
const fieldDraftCache = new Map<
  string,
  {
    id: string;
    label: string;
    style: string;
    required: string;
    placeholder: string;
    timestamp: number;
  }
>();

// Track active field management sessions (userId_guildId -> timestamp)
// A value of SESSION_COMPLETED means the session was completed via Done
const fieldSessionMap = new Map<string, number>();
const SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_COMPLETED = -1;

function getSessionKey(userId: string, guildId: string): string {
  return `${userId}_${guildId}`;
}

type SessionStatus = 'active' | 'expired' | 'completed' | 'none';

function checkSession(userId: string, guildId: string): SessionStatus {
  const key = getSessionKey(userId, guildId);
  const sessionStart = fieldSessionMap.get(key);
  if (sessionStart === undefined) return 'none';
  if (sessionStart === SESSION_COMPLETED) return 'completed';
  if (Date.now() - sessionStart >= SESSION_TIMEOUT_MS) return 'expired';
  return 'active';
}

function completeSession(userId: string, guildId: string): void {
  fieldSessionMap.set(getSessionKey(userId, guildId), SESSION_COMPLETED);
}

// Clean up old drafts and expired/completed sessions every minute
setInterval(() => {
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  for (const [key, value] of fieldDraftCache.entries()) {
    if (value.timestamp < fiveMinutesAgo) {
      fieldDraftCache.delete(key);
    }
  }
  const now = Date.now();
  for (const [key, timestamp] of fieldSessionMap.entries()) {
    if (
      timestamp === SESSION_COMPLETED ||
      (timestamp > 0 && now - timestamp >= SESSION_TIMEOUT_MS)
    ) {
      fieldSessionMap.delete(key);
    }
  }
}, 60 * 1000);

/**
 * Handler for /application position fields command
 * Interactive UI for managing custom input fields
 */
export async function applicationFieldsHandler(
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

    const positionRepo = AppDataSource.getRepository(Position);
    const position = await positionRepo.findOne({
      where: { id: positionId, guildId },
    });

    if (!position) {
      await interaction.reply({
        content: pl.notFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Start a new session for this user
    fieldSessionMap.set(getSessionKey(interaction.user.id, guildId), Date.now());

    await showFieldManager(interaction, position);
  } catch (error) {
    await handleInteractionError(interaction, error, 'applicationFieldsHandler');
  }
}

/**
 * Show the main field management interface
 */
async function showFieldManager(
  interaction:
    | ChatInputCommandInteraction
    | ButtonInteraction
    | StringSelectMenuInteraction
    | ModalSubmitInteraction,
  position: Position,
): Promise<void> {
  const fields = position.customFields || [];

  const embed = new EmbedBuilder()
    .setTitle(`🔧 ${fl.title}: ${position.emoji || '📝'} ${position.title}`)
    .setColor(0x5865f2)
    .setDescription(
      fields.length === 0
        ? `*${fl.noFields}*`
        : `**Current Fields (${fields.length}/5)**\n` +
            fields
              .map(
                (f, i) =>
                  `${i + 1}. **${f.label}** (${f.style}${f.required ? ', required' : ', optional'})`,
              )
              .join('\n'),
    )
    .setFooter({ text: `Position ID: ${position.id}` });

  const buttons = new ActionRowBuilder<ButtonBuilder>();

  // Always add Done button first
  buttons.addComponents(
    new ButtonBuilder()
      .setCustomId(`appfield_done_${position.id}`)
      .setLabel('Done')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('✅'),
  );

  if (fields.length < 5) {
    buttons.addComponents(
      new ButtonBuilder()
        .setCustomId(`appfield_add_${position.id}`)
        .setLabel('Add Field')
        .setStyle(ButtonStyle.Success)
        .setEmoji('➕'),
    );
  }

  if (fields.length > 0) {
    buttons.addComponents(
      new ButtonBuilder()
        .setCustomId(`appfield_delete_${position.id}`)
        .setLabel('Delete Field')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🗑️'),
      new ButtonBuilder()
        .setCustomId(`appfield_preview_${position.id}`)
        .setLabel('Preview')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('👁️'),
    );
  }

  // Add reorder button if there are 2+ fields (only if we have room)
  if (fields.length >= 2 && buttons.components.length < 5) {
    buttons.addComponents(
      new ButtonBuilder()
        .setCustomId(`appfield_reorder_${position.id}`)
        .setLabel('Reorder')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🔀'),
    );
  }

  if (interaction.replied || interaction.deferred) {
    await interaction.editReply({
      embeds: [embed],
      components: [buttons],
    });
  } else {
    await interaction.reply({
      embeds: [embed],
      components: [buttons],
      flags: [MessageFlags.Ephemeral],
    });
  }
}

/**
 * Show modal to add a new field
 */
async function showAddFieldModal(
  interaction: ButtonInteraction,
  positionId: number,
): Promise<void> {
  const userId = interaction.user.id;
  const cacheKey = `${userId}_app_${positionId}`;
  const cached = fieldDraftCache.get(cacheKey);

  const modal = new ModalBuilder()
    .setCustomId(`appfield_add_modal_${positionId}`)
    .setTitle('Add Custom Field');

  const fieldId = new TextInputBuilder()
    .setCustomId('field_id')
    .setLabel('Field ID (lowercase, underscores)')
    .setPlaceholder('e.g., player_name, portfolio_link')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(50);
  if (cached?.id) fieldId.setValue(cached.id);

  const fieldLabel = new TextInputBuilder()
    .setCustomId('field_label')
    .setLabel('Field Label (shown to applicant)')
    .setPlaceholder('e.g., Player Name, Portfolio Link')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(45);
  if (cached?.label) fieldLabel.setValue(cached.label);

  const fieldStyle = new TextInputBuilder()
    .setCustomId('field_style')
    .setLabel('Field Style (short or paragraph)')
    .setPlaceholder('short')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(10);
  if (cached?.style) fieldStyle.setValue(cached.style);

  const fieldRequired = new TextInputBuilder()
    .setCustomId('field_required')
    .setLabel('Required? (yes or no)')
    .setPlaceholder('yes')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(3);
  if (cached?.required) fieldRequired.setValue(cached.required);

  const fieldPlaceholder = new TextInputBuilder()
    .setCustomId('field_placeholder')
    .setLabel('Placeholder Text (optional)')
    .setPlaceholder('Optional hint text...')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(100);
  if (cached?.placeholder) fieldPlaceholder.setValue(cached.placeholder);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(fieldId),
    new ActionRowBuilder<TextInputBuilder>().addComponents(fieldLabel),
    new ActionRowBuilder<TextInputBuilder>().addComponents(fieldStyle),
    new ActionRowBuilder<TextInputBuilder>().addComponents(fieldRequired),
    new ActionRowBuilder<TextInputBuilder>().addComponents(fieldPlaceholder),
  );

  await interaction.showModal(modal);
}

/**
 * Handle add field modal submission
 */
export async function handleAppAddFieldModal(
  interaction: ModalSubmitInteraction,
  positionId: number,
): Promise<void> {
  try {
    const guildId = interaction.guildId!;
    const userId = interaction.user.id;
    const cacheKey = `${userId}_app_${positionId}`;
    const positionRepo = AppDataSource.getRepository(Position);

    const position = await positionRepo.findOne({
      where: { id: positionId, guildId },
    });

    if (!position) {
      await interaction.reply({
        content: `❌ ${pl.notFound}`,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Check session status
    const sessionStatus = checkSession(userId, guildId);
    if (sessionStatus !== 'active') {
      await interaction.reply({
        content: sessionStatus === 'completed' ? pl.sessionCompleted : pl.sessionExpired,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const fieldId = interaction.fields.getTextInputValue('field_id').toLowerCase().trim();
    const fieldLabel = interaction.fields.getTextInputValue('field_label').trim();
    const fieldStyle = interaction.fields.getTextInputValue('field_style').toLowerCase().trim();
    const fieldRequired = interaction.fields
      .getTextInputValue('field_required')
      .toLowerCase()
      .trim();
    const fieldPlaceholder =
      interaction.fields.getTextInputValue('field_placeholder')?.trim() || undefined;

    // Cache the values in case of validation failure
    fieldDraftCache.set(cacheKey, {
      id: fieldId,
      label: fieldLabel,
      style: fieldStyle,
      required: fieldRequired,
      placeholder: fieldPlaceholder || '',
      timestamp: Date.now(),
    });

    // Validate field ID
    if (!/^[a-z0-9_]+$/.test(fieldId)) {
      await interaction.reply({
        content: `❌ ${fl.invalidId}`,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Validate field style
    if (fieldStyle !== 'short' && fieldStyle !== 'paragraph') {
      await interaction.reply({
        content: `❌ ${fl.invalidStyle}`,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Validate required field
    const required = fieldRequired === 'yes' || fieldRequired === 'y' || fieldRequired === 'true';

    const fields = position.customFields || [];

    // Check for duplicate field ID
    if (fields.some(f => f.id === fieldId)) {
      await interaction.reply({
        content: `❌ ${fl.duplicateId}`,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Check field limit
    if (fields.length >= 5) {
      await interaction.reply({
        content: `❌ ${fl.maxReached}`,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Add new field
    const newField: CustomInputField = {
      id: fieldId,
      label: fieldLabel,
      style: fieldStyle as 'short' | 'paragraph',
      required,
      placeholder: fieldPlaceholder,
      maxLength: fieldStyle === 'short' ? 100 : 4000,
    };

    fields.push(newField);
    position.customFields = fields;
    await positionRepo.save(position);

    // Clear the cache on success
    fieldDraftCache.delete(cacheKey);

    enhancedLogger.info(`Field added to position: ${positionId}`, LogCategory.COMMAND_EXECUTION, {
      guildId,
      positionId,
      fieldId,
    });

    await interaction.deferUpdate();
    await showFieldManager(interaction, position);
  } catch (error) {
    await handleInteractionError(interaction, error, 'handleAppAddFieldModal');
  }
}

/**
 * Show select menu to choose field to delete
 */
async function showDeleteFieldSelect(
  interaction: ButtonInteraction,
  position: Position,
): Promise<void> {
  const fields = position.customFields || [];

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`appfield_delete_select_${position.id}`)
    .setPlaceholder('Select a field to delete')
    .addOptions(
      fields.map((field, index) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(`${index + 1}. ${field.label}`)
          .setValue(field.id)
          .setDescription(`${field.style}, ${field.required ? 'required' : 'optional'}`),
      ),
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  const cancelButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`appfield_cancel_${position.id}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.update({
    content: '🗑️ Select a field to delete:',
    embeds: [],
    components: [row, cancelButton],
  });
}

/**
 * Show reorder interface with up/down buttons for each field
 */
async function showReorderInterface(
  interaction: ButtonInteraction,
  position: Position,
): Promise<void> {
  const fields = position.customFields || [];

  const embed = new EmbedBuilder()
    .setTitle(`🔀 Reorder Fields: ${position.title}`)
    .setColor(0x5865f2)
    .setDescription(
      '**Current Order:**\n' +
        fields
          .map(
            (f, i) =>
              `${i + 1}. **${f.label}** (${f.style}${f.required ? ', required' : ', optional'})`,
          )
          .join('\n') +
        '\n\n*Use the buttons below to move fields up or down.*',
    );

  const components: ActionRowBuilder<ButtonBuilder>[] = [];

  // Create up/down buttons for each field
  for (let i = 0; i < fields.length; i++) {
    const row = new ActionRowBuilder<ButtonBuilder>();

    // Up button (disabled for first field)
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`appfield_moveup_${i}_${position.id}`)
        .setLabel('↑')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(i === 0),
    );

    // Field label
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`appfield_label_${i}_${position.id}`)
        .setLabel(`${i + 1}. ${fields[i].label}`)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true),
    );

    // Down button (disabled for last field)
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`appfield_movedown_${i}_${position.id}`)
        .setLabel('↓')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(i === fields.length - 1),
    );

    // Merge Done button into last field's row to stay within 5 action rows
    if (i === fields.length - 1) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`appfield_reorder_done_${position.id}`)
          .setLabel('Done')
          .setStyle(ButtonStyle.Success)
          .setEmoji('✅'),
      );
    }

    components.push(row);
  }

  await interaction.update({
    embeds: [embed],
    components,
    content: null,
  });
}

/**
 * Show preview of the modal with configured fields
 */
async function showModalPreview(interaction: ButtonInteraction, position: Position): Promise<void> {
  const fields = position.customFields || [];

  if (fields.length === 0) {
    await interaction.reply({
      content: '❌ No fields to preview! Add at least one field first.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`appfield_preview_modal_${position.id}`)
    .setTitle(`${position.emoji || '📝'} ${position.title}`.substring(0, 45));

  for (const field of fields) {
    const input = new TextInputBuilder()
      .setCustomId(field.id)
      .setLabel(field.label)
      .setStyle(field.style === 'short' ? TextInputStyle.Short : TextInputStyle.Paragraph)
      .setRequired(field.required);

    if (field.placeholder) input.setPlaceholder(field.placeholder);
    if (field.minLength) input.setMinLength(field.minLength);
    if (field.maxLength) input.setMaxLength(field.maxLength);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  }

  await interaction.showModal(modal);
}

/**
 * Handle preview modal submission (just dismiss it)
 */
export async function handleAppPreviewModal(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.reply({
    content: `✅ ${fl.previewNote}`,
    flags: [MessageFlags.Ephemeral],
  });
}

/**
 * Handle field delete confirmation
 */
async function handleDeleteField(
  interaction: StringSelectMenuInteraction,
  position: Position,
): Promise<void> {
  const fieldId = interaction.values[0];
  const fields = position.customFields || [];
  const fieldIndex = fields.findIndex(f => f.id === fieldId);

  if (fieldIndex === -1) {
    await interaction.reply({
      content: `❌ ${fl.notFound}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Remove the field
  fields.splice(fieldIndex, 1);
  position.customFields = fields;

  // Save to database
  const positionRepo = AppDataSource.getRepository(Position);
  await positionRepo.save(position);

  enhancedLogger.info(
    `Field deleted from position: ${position.id}`,
    LogCategory.COMMAND_EXECUTION,
    { guildId: position.guildId, positionId: position.id, fieldId },
  );

  // Update the message back to field manager
  await interaction.deferUpdate();
  await showFieldManager(interaction, position);
}

/**
 * Handle moving a field up or down
 */
async function handleMoveField(
  interaction: ButtonInteraction,
  direction: 'up' | 'down',
  fieldIndex: number,
  position: Position,
): Promise<void> {
  const fields = position.customFields || [];

  if (fieldIndex < 0 || fieldIndex >= fields.length) {
    await interaction.followUp({
      content: '❌ Invalid field index!',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Calculate new position
  const newIndex = direction === 'up' ? fieldIndex - 1 : fieldIndex + 1;

  // Validate new position
  if (newIndex < 0 || newIndex >= fields.length) {
    await interaction.followUp({
      content: `❌ Cannot move field ${direction}!`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Swap fields
  const temp = fields[fieldIndex];
  fields[fieldIndex] = fields[newIndex];
  fields[newIndex] = temp;

  position.customFields = fields;

  // Save to database
  const positionRepo = AppDataSource.getRepository(Position);
  await positionRepo.save(position);

  enhancedLogger.info(
    `Field reordered in position: ${position.id}`,
    LogCategory.COMMAND_EXECUTION,
    {
      guildId: position.guildId,
      positionId: position.id,
      fieldIndex,
      newIndex,
    },
  );

  // Refresh the reorder interface
  await showReorderInterface(interaction, position);
}

/**
 * Main button interaction handler
 */
export async function handleAppFieldButton(
  interaction: ButtonInteraction,
  action: string,
  positionId: number,
): Promise<void> {
  try {
    const guildId = interaction.guildId!;
    const positionRepo = AppDataSource.getRepository(Position);

    const position = await positionRepo.findOne({
      where: { id: positionId, guildId },
    });

    if (!position) {
      await interaction.reply({
        content: `❌ ${pl.notFound}`,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Check session status
    const sessionStatus = checkSession(interaction.user.id, guildId);
    if (sessionStatus !== 'active') {
      await interaction.update({
        content: sessionStatus === 'completed' ? pl.sessionCompleted : pl.sessionExpired,
        embeds: [],
        components: [],
      });
      return;
    }

    switch (action) {
      case 'add':
        await showAddFieldModal(interaction, positionId);
        break;
      case 'delete':
        await showDeleteFieldSelect(interaction, position);
        break;
      case 'preview':
        await showModalPreview(interaction, position);
        break;
      case 'reorder':
        await showReorderInterface(interaction, position);
        break;
      case 'reorder_done':
        await showFieldManager(interaction, position);
        break;
      case 'done':
        completeSession(interaction.user.id, guildId);
        await interaction.update({
          content: `✅ ${fl.complete}`,
          embeds: [],
          components: [],
        });
        break;
      case 'cancel':
        await showFieldManager(interaction, position);
        break;
      default: {
        // Handle moveup/movedown with index
        const moveUpMatch = action.match(/^moveup_(\d+)$/);
        const moveDownMatch = action.match(/^movedown_(\d+)$/);

        if (moveUpMatch) {
          const fieldIndex = parseInt(moveUpMatch[1], 10);
          await handleMoveField(interaction, 'up', fieldIndex, position);
        } else if (moveDownMatch) {
          const fieldIndex = parseInt(moveDownMatch[1], 10);
          await handleMoveField(interaction, 'down', fieldIndex, position);
        }
        break;
      }
    }
  } catch (error) {
    await handleInteractionError(interaction, error, 'handleAppFieldButton');
  }
}

/**
 * Handle field selection for delete
 */
export async function handleAppFieldSelectMenu(
  interaction: StringSelectMenuInteraction,
  action: string,
  positionId: number,
): Promise<void> {
  try {
    const guildId = interaction.guildId!;
    const positionRepo = AppDataSource.getRepository(Position);

    const position = await positionRepo.findOne({
      where: { id: positionId, guildId },
    });

    if (!position) {
      await interaction.reply({
        content: `❌ ${pl.notFound}`,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Check session status
    const sessionStatus = checkSession(interaction.user.id, guildId);
    if (sessionStatus !== 'active') {
      await interaction.update({
        content: sessionStatus === 'completed' ? pl.sessionCompleted : pl.sessionExpired,
        embeds: [],
        components: [],
      });
      return;
    }

    if (action === 'delete') {
      await handleDeleteField(interaction, position);
    }
  } catch {
    await interaction
      .reply({
        content: '❌ An error occurred processing your selection',
        flags: [MessageFlags.Ephemeral],
      })
      .catch(() => {
        // Interaction may have already been handled
      });
  }
}

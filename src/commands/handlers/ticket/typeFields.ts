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
import { CustomTicketType } from '../../../typeorm/entities/ticket/CustomTicketType';
import { enhancedLogger, handleInteractionError, LogCategory, lang } from '../../../utils';

interface CustomInputField {
  id: string;
  label: string;
  style: 'short' | 'paragraph';
  placeholder?: string;
  required: boolean;
  minLength?: number;
  maxLength?: number;
}

// Store last attempted field values per user+type (clears after 5 minutes)
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

// Clean up old drafts every minute
setInterval(() => {
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  for (const [key, value] of fieldDraftCache.entries()) {
    if (value.timestamp < fiveMinutesAgo) {
      fieldDraftCache.delete(key);
    }
  }
}, 60 * 1000);

/**
 * Handler for /ticket type-fields command
 * Interactive UI for managing custom input fields
 */
export async function typeFieldsHandler(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    if (!interaction.guild) {
      enhancedLogger.warn('Type-fields handler: guild not found', LogCategory.COMMAND_EXECUTION, {
        userId: interaction.user.id,
      });
      await interaction.reply({
        content: lang.general.cmdGuildNotFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const guildId = interaction.guild.id;
    const typeId = interaction.options.getString('type', true);

    enhancedLogger.debug(
      `Command: /ticket type-fields type=${typeId}`,
      LogCategory.COMMAND_EXECUTION,
      { userId: interaction.user.id, guildId, typeId },
    );

    const typeRepo = AppDataSource.getRepository(CustomTicketType);

    const ticketType = await typeRepo.findOne({
      where: { guildId, typeId },
    });

    if (!ticketType) {
      enhancedLogger.warn(
        `Type-fields: type '${typeId}' not found`,
        LogCategory.COMMAND_EXECUTION,
        { userId: interaction.user.id, guildId, typeId },
      );
      await interaction.reply({
        content: '❌ Ticket type not found!',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    await showFieldManager(interaction, ticketType);
  } catch (error) {
    await handleInteractionError(interaction, error, 'typeFieldsHandler');
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
  ticketType: CustomTicketType,
): Promise<void> {
  const fields = ticketType.customFields || [];

  const embed = new EmbedBuilder()
    .setTitle(`🔧 Configure Fields: ${ticketType.emoji || '📋'} ${ticketType.displayName}`)
    .setColor(parseInt(ticketType.embedColor.replace('#', ''), 16))
    .setDescription(
      fields.length === 0
        ? '*No fields configured. Add fields to customize the ticket form.*'
        : `**Current Fields (${fields.length}/5)**\n` +
            fields
              .map(
                (f, i) =>
                  `${i + 1}. **${f.label}** (${f.style}${f.required ? ', required' : ', optional'})`,
              )
              .join('\n'),
    )
    .setFooter({ text: `Type ID: ${ticketType.typeId}` });

  const buttons = new ActionRowBuilder<ButtonBuilder>();

  // Always add Done button first
  buttons.addComponents(
    new ButtonBuilder()
      .setCustomId(`field_done_${ticketType.typeId}`)
      .setLabel('Done')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('✅'),
  );

  if (fields.length < 5) {
    buttons.addComponents(
      new ButtonBuilder()
        .setCustomId(`field_add_${ticketType.typeId}`)
        .setLabel('Add Field')
        .setStyle(ButtonStyle.Success)
        .setEmoji('➕'),
    );
  }

  if (fields.length > 0) {
    buttons.addComponents(
      new ButtonBuilder()
        .setCustomId(`field_delete_${ticketType.typeId}`)
        .setLabel('Delete Field')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🗑️'),
      new ButtonBuilder()
        .setCustomId(`field_preview_${ticketType.typeId}`)
        .setLabel('Preview')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('👁️'),
    );
  }

  // Add reorder button if there are 2+ fields (only if we have room)
  if (fields.length >= 2 && buttons.components.length < 5) {
    buttons.addComponents(
      new ButtonBuilder()
        .setCustomId(`field_reorder_${ticketType.typeId}`)
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
async function showAddFieldModal(interaction: ButtonInteraction, typeId: string): Promise<void> {
  const userId = interaction.user.id;
  const cacheKey = `${userId}_${typeId}`;
  const cached = fieldDraftCache.get(cacheKey);

  const modal = new ModalBuilder()
    .setCustomId(`field_add_modal_${typeId}`)
    .setTitle('Add Custom Field');

  const fieldId = new TextInputBuilder()
    .setCustomId('field_id')
    .setLabel('Field ID (lowercase, underscores)')
    .setPlaceholder('e.g., player_name, incident_date')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(50);
  if (cached?.id) fieldId.setValue(cached.id);

  const fieldLabel = new TextInputBuilder()
    .setCustomId('field_label')
    .setLabel('Field Label (shown to user)')
    .setPlaceholder('e.g., Player Name, Incident Date')
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
export async function handleAddFieldModal(
  interaction: ModalSubmitInteraction,
  typeId: string,
): Promise<void> {
  try {
    const guildId = interaction.guildId!;
    const userId = interaction.user.id;
    const cacheKey = `${userId}_${typeId}`;
    const typeRepo = AppDataSource.getRepository(CustomTicketType);

    const ticketType = await typeRepo.findOne({
      where: { guildId, typeId },
    });

    if (!ticketType) {
      await interaction.reply({
        content: '❌ Ticket type not found!',
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
        content: '❌ Field ID must contain only lowercase letters, numbers, and underscores!',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Validate field style
    if (fieldStyle !== 'short' && fieldStyle !== 'paragraph') {
      await interaction.reply({
        content: '❌ Field style must be either "short" or "paragraph"!',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Validate required field
    const required = fieldRequired === 'yes' || fieldRequired === 'y' || fieldRequired === 'true';

    const fields = ticketType.customFields || [];

    // Check for duplicate field ID
    if (fields.some(f => f.id === fieldId)) {
      await interaction.reply({
        content: `❌ A field with ID "${fieldId}" already exists!`,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Check field limit
    if (fields.length >= 5) {
      await interaction.reply({
        content: '❌ Maximum 5 fields per ticket type (Discord limitation)!',
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
    ticketType.customFields = fields;
    await typeRepo.save(ticketType);

    // Clear the cache on success
    fieldDraftCache.delete(cacheKey);

    enhancedLogger.info(`Field added to ticket type: ${typeId}`, LogCategory.COMMAND_EXECUTION, {
      guildId,
      typeId,
      fieldId,
    });

    await interaction.deferUpdate();
    await showFieldManager(interaction, ticketType);
  } catch (error) {
    await handleInteractionError(interaction, error, 'handleAddFieldModal');
  }
}

/**
 * Show select menu to choose field to edit
 */
async function showEditFieldSelect(
  interaction: ButtonInteraction,
  ticketType: CustomTicketType,
): Promise<void> {
  const fields = ticketType.customFields || [];

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`field_edit_select_${ticketType.typeId}`)
    .setPlaceholder('Select a field to edit')
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
      .setCustomId(`field_cancel_${ticketType.typeId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.update({
    content: '📝 Select a field to edit:',
    embeds: [],
    components: [row, cancelButton],
  });
}

/**
 * Show select menu to choose field to delete
 */
async function showDeleteFieldSelect(
  interaction: ButtonInteraction,
  ticketType: CustomTicketType,
): Promise<void> {
  const fields = ticketType.customFields || [];

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`field_delete_select_${ticketType.typeId}`)
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
      .setCustomId(`field_cancel_${ticketType.typeId}`)
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
  ticketType: CustomTicketType,
): Promise<void> {
  const fields = ticketType.customFields || [];

  const embed = new EmbedBuilder()
    .setTitle(`🔀 Reorder Fields: ${ticketType.displayName}`)
    .setColor(parseInt(ticketType.embedColor.replace('#', ''), 16))
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
        .setCustomId(`field_moveup_${i}_${ticketType.typeId}`)
        .setLabel('↑')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(i === 0),
    );

    // Field label
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`field_label_${i}_${ticketType.typeId}`)
        .setLabel(`${i + 1}. ${fields[i].label}`)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true),
    );

    // Down button (disabled for last field)
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`field_movedown_${i}_${ticketType.typeId}`)
        .setLabel('↓')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(i === fields.length - 1),
    );

    components.push(row);
  }

  // Add done button
  const doneRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`field_reorder_done_${ticketType.typeId}`)
      .setLabel('Done Reordering')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅'),
  );
  components.push(doneRow);

  await interaction.update({
    embeds: [embed],
    components,
    content: null,
  });
}

/**
 * Show preview of the modal with configured fields
 */
async function showModalPreview(
  interaction: ButtonInteraction,
  ticketType: CustomTicketType,
): Promise<void> {
  const fields = ticketType.customFields || [];

  if (fields.length === 0) {
    await interaction.reply({
      content: '❌ No fields to preview! Add at least one field first.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`field_preview_modal_${ticketType.typeId}`)
    .setTitle(`${ticketType.emoji || '📋'} ${ticketType.displayName}`.substring(0, 45));

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
export async function handlePreviewModal(
  interaction: ModalSubmitInteraction,
  _typeId: string,
): Promise<void> {
  await interaction.reply({
    content: '✅ This was just a preview! The modal works correctly.',
    flags: [MessageFlags.Ephemeral],
  });
}

/**
 * Handle field delete confirmation
 */
async function handleDeleteField(
  interaction: StringSelectMenuInteraction,
  ticketType: CustomTicketType,
): Promise<void> {
  const fieldId = interaction.values[0];
  const fields = ticketType.customFields || [];
  const fieldIndex = fields.findIndex(f => f.id === fieldId);

  if (fieldIndex === -1) {
    await interaction.reply({
      content: '❌ Field not found!',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Remove the field
  fields.splice(fieldIndex, 1);
  ticketType.customFields = fields;

  // Save to database
  const typeRepo = AppDataSource.getRepository(CustomTicketType);
  await typeRepo.save(ticketType);

  enhancedLogger.info(
    `Field deleted from ticket type: ${ticketType.typeId}`,
    LogCategory.COMMAND_EXECUTION,
    { guildId: ticketType.guildId, typeId: ticketType.typeId, fieldId },
  );

  // Update the message with the new field list
  await interaction.update({
    content: '✅ Field deleted successfully!',
    embeds: [],
    components: [],
  });

  // Show updated field manager after a brief delay
  setTimeout(async () => {
    await showFieldManager(interaction, ticketType);
  }, 1000);
}

/**
 * Handle moving a field up or down
 */
async function handleMoveField(
  interaction: ButtonInteraction,
  direction: 'up' | 'down',
  fieldIndex: number,
  ticketType: CustomTicketType,
): Promise<void> {
  const fields = ticketType.customFields || [];

  if (fieldIndex < 0 || fieldIndex >= fields.length) {
    await interaction.reply({
      content: '❌ Invalid field index!',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Calculate new position
  const newIndex = direction === 'up' ? fieldIndex - 1 : fieldIndex + 1;

  // Validate new position
  if (newIndex < 0 || newIndex >= fields.length) {
    await interaction.reply({
      content: `❌ Cannot move field ${direction}!`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Swap fields
  const temp = fields[fieldIndex];
  fields[fieldIndex] = fields[newIndex];
  fields[newIndex] = temp;

  ticketType.customFields = fields;

  // Save to database
  const typeRepo = AppDataSource.getRepository(CustomTicketType);
  await typeRepo.save(ticketType);

  enhancedLogger.info(
    `Field reordered in ticket type: ${ticketType.typeId}`,
    LogCategory.COMMAND_EXECUTION,
    { guildId: ticketType.guildId, typeId: ticketType.typeId, fieldIndex, newIndex },
  );

  // Refresh the reorder interface
  await showReorderInterface(interaction, ticketType);
}

/**
 * Main button interaction handler
 */
export async function handleFieldButton(
  interaction: ButtonInteraction,
  action: string,
  typeId: string,
): Promise<void> {
  try {
    const guildId = interaction.guildId!;
    const typeRepo = AppDataSource.getRepository(CustomTicketType);

    const ticketType = await typeRepo.findOne({
      where: { guildId, typeId },
    });

    if (!ticketType) {
      await interaction.reply({
        content: '❌ Ticket type not found!',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    switch (action) {
      case 'add':
        await showAddFieldModal(interaction, typeId);
        break;
      case 'edit':
        await showEditFieldSelect(interaction, ticketType);
        break;
      case 'delete':
        await showDeleteFieldSelect(interaction, ticketType);
        break;
      case 'preview':
        await showModalPreview(interaction, ticketType);
        break;
      case 'reorder':
        await showReorderInterface(interaction, ticketType);
        break;
      case 'reorder_done':
        await showFieldManager(interaction, ticketType);
        break;
      case 'done':
        await interaction.update({
          content: '✅ Field configuration complete!',
          embeds: [],
          components: [],
        });
        break;
      case 'cancel':
        await showFieldManager(interaction, ticketType);
        break;
      default: {
        // Handle moveup/movedown with index
        const moveUpMatch = action.match(/^moveup_(\d+)$/);
        const moveDownMatch = action.match(/^movedown_(\d+)$/);

        if (moveUpMatch) {
          const fieldIndex = parseInt(moveUpMatch[1], 10);
          await handleMoveField(interaction, 'up', fieldIndex, ticketType);
        } else if (moveDownMatch) {
          const fieldIndex = parseInt(moveDownMatch[1], 10);
          await handleMoveField(interaction, 'down', fieldIndex, ticketType);
        }
        break;
      }
    }
  } catch (error) {
    await handleInteractionError(interaction, error, 'handleFieldButton');
  }
}

/**
 * Handle field selection for delete
 */
export async function handleFieldSelectMenu(
  interaction: StringSelectMenuInteraction,
  action: string,
  typeId: string,
): Promise<void> {
  try {
    const guildId = interaction.guildId!;
    const typeRepo = AppDataSource.getRepository(CustomTicketType);

    const ticketType = await typeRepo.findOne({
      where: { guildId, typeId },
    });

    if (!ticketType) {
      await interaction.reply({
        content: '❌ Ticket type not found!',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    if (action === 'delete') {
      await handleDeleteField(interaction, ticketType);
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

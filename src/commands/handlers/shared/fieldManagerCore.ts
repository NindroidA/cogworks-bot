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
import type { CustomInputField } from '../../../typeorm/entities/shared/CustomInputField';
import {
  CACHE_TTL,
  enhancedLogger,
  handleInteractionError,
  INTERVALS,
  LANGF,
  LogCategory,
  lang,
  MAX,
  sanitizeUserInput,
  TEXT_LIMITS,
} from '../../../utils';

const btn = lang.general.buttons;
const fm = lang.general.fieldManager;

/**
 * Interface for entities that support custom input fields.
 * Both Position and CustomTicketType implement this pattern.
 */
export interface FieldBearingEntity {
  customFields: CustomInputField[] | null;
  guildId: string;
}

/**
 * Configuration for the field manager, parameterized per entity type.
 */
export interface FieldManagerConfig<T extends FieldBearingEntity> {
  /** Button ID prefix (e.g., 'appfield_' or 'field_') */
  prefix: string;
  /** Human-readable entity type for logs (e.g., 'position' or 'ticket type') */
  entityLabel: string;
  /** Get the display title for the embed */
  getDisplayTitle: (entity: T) => string;
  /** Get the embed color */
  getEmbedColor: (entity: T) => number;
  /** Get footer text for the embed */
  getFooterText: (entity: T) => string;
  /** Get a string identifier for button custom IDs */
  getEntityId: (entity: T) => string;
  /** Find the entity by guild + identifier */
  findEntity: (guildId: string, entityId: string) => Promise<T | null>;
  /** Save the entity after modifications */
  saveEntity: (entity: T) => Promise<void>;
  /** Messages */
  messages: {
    notFound: string;
    noFields: string;
    fieldComplete: string;
    previewNote: string;
    invalidId: string;
    invalidStyle: string;
    duplicateId: string;
    maxReached: string;
    fieldNotFound: string;
  };
  /** Whether to show edit option in field manager */
  showEdit?: boolean;
  /** Session management callbacks (optional, used by application fields) */
  session?: {
    check: (userId: string, guildId: string, entityId?: string) => 'active' | 'expired' | 'completed' | 'none';
    complete: (userId: string, guildId: string, entityId?: string) => void;
    expiredMessage: string;
    completedMessage: string;
  };
}

// Store last attempted field values per user+entity (clears after 5 minutes)
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
const fieldDraftCleanupInterval = setInterval(() => {
  const cutoff = Date.now() - CACHE_TTL.FIELD_DRAFT;
  for (const [key, value] of fieldDraftCache.entries()) {
    if (value.timestamp < cutoff) {
      fieldDraftCache.delete(key);
    }
  }
}, INTERVALS.FIELD_DRAFT_CLEANUP);

/** Stop the field draft cleanup interval (call on shutdown) */
export function stopFieldDraftCleanup(): void {
  clearInterval(fieldDraftCleanupInterval);
}

/**
 * Show the main field management interface
 */
export async function showFieldManager<T extends FieldBearingEntity>(
  interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
  entity: T,
  config: FieldManagerConfig<T>,
): Promise<void> {
  const fields = entity.customFields || [];
  const { prefix } = config;
  const entityId = config.getEntityId(entity);

  const embed = new EmbedBuilder()
    .setTitle(config.getDisplayTitle(entity))
    .setColor(config.getEmbedColor(entity))
    .setDescription(
      fields.length === 0
        ? `*${config.messages.noFields}*`
        : `**Current Fields (${fields.length}/${MAX.CUSTOM_FIELDS_PER_ENTITY})**\n` +
            fields
              .map((f, i) => `${i + 1}. **${f.label}** (${f.style}${f.required ? ', required' : ', optional'})`)
              .join('\n'),
    )
    .setFooter({ text: config.getFooterText(entity) });

  const buttons = new ActionRowBuilder<ButtonBuilder>();

  // Always add Done button first
  buttons.addComponents(
    new ButtonBuilder()
      .setCustomId(`${prefix}done_${entityId}`)
      .setLabel(btn.done)
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('✅'),
  );

  if (fields.length < MAX.CUSTOM_FIELDS_PER_ENTITY) {
    buttons.addComponents(
      new ButtonBuilder()
        .setCustomId(`${prefix}add_${entityId}`)
        .setLabel(btn.addField)
        .setStyle(ButtonStyle.Success)
        .setEmoji('➕'),
    );
  }

  if (fields.length > 0) {
    buttons.addComponents(
      new ButtonBuilder()
        .setCustomId(`${prefix}delete_${entityId}`)
        .setLabel(btn.deleteField)
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🗑️'),
      new ButtonBuilder()
        .setCustomId(`${prefix}preview_${entityId}`)
        .setLabel(btn.preview)
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('👁️'),
    );
  }

  // Add reorder button if there are 2+ fields (only if we have room)
  if (fields.length >= 2 && buttons.components.length < 5) {
    buttons.addComponents(
      new ButtonBuilder()
        .setCustomId(`${prefix}reorder_${entityId}`)
        .setLabel(btn.reorder)
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
async function showAddFieldModal<T extends FieldBearingEntity>(
  interaction: ButtonInteraction,
  entityId: string,
  config: FieldManagerConfig<T>,
): Promise<void> {
  const userId = interaction.user.id;
  const cacheKey = `${userId}_${config.prefix}${entityId}`;
  const cached = fieldDraftCache.get(cacheKey);

  const modal = new ModalBuilder().setCustomId(`${config.prefix}add_modal_${entityId}`).setTitle(fm.modalTitle);

  const fieldId = new TextInputBuilder()
    .setCustomId('field_id')
    .setLabel(fm.fieldIdLabel)
    .setPlaceholder(fm.fieldIdPlaceholder)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(50);
  if (cached?.id) fieldId.setValue(cached.id);

  const fieldLabel = new TextInputBuilder()
    .setCustomId('field_label')
    .setLabel(fm.fieldLabelLabel)
    .setPlaceholder(fm.fieldLabelPlaceholder)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(45);
  if (cached?.label) fieldLabel.setValue(cached.label);

  const fieldStyle = new TextInputBuilder()
    .setCustomId('field_style')
    .setLabel(fm.fieldStyleLabel)
    .setPlaceholder(fm.fieldStylePlaceholder)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(10);
  if (cached?.style) fieldStyle.setValue(cached.style);

  const fieldRequired = new TextInputBuilder()
    .setCustomId('field_required')
    .setLabel(fm.fieldRequiredLabel)
    .setPlaceholder(fm.fieldRequiredPlaceholder)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(3);
  if (cached?.required) fieldRequired.setValue(cached.required);

  const fieldPlaceholder = new TextInputBuilder()
    .setCustomId('field_placeholder')
    .setLabel(fm.fieldPlaceholderLabel)
    .setPlaceholder(fm.fieldPlaceholderPlaceholder)
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
export async function handleAddFieldModal<T extends FieldBearingEntity>(
  interaction: ModalSubmitInteraction,
  entityId: string,
  config: FieldManagerConfig<T>,
): Promise<void> {
  try {
    const guildId = interaction.guildId!;
    const userId = interaction.user.id;
    const cacheKey = `${userId}_${config.prefix}${entityId}`;

    const entity = await config.findEntity(guildId, entityId);
    if (!entity) {
      await interaction.reply({
        content: `❌ ${config.messages.notFound}`,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Check session if configured
    if (config.session) {
      const sessionStatus = config.session.check(userId, guildId, entityId);
      if (sessionStatus !== 'active') {
        await interaction.reply({
          content: sessionStatus === 'completed' ? config.session.completedMessage : config.session.expiredMessage,
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }
    }

    const fieldId = interaction.fields.getTextInputValue('field_id').toLowerCase().trim();
    const fieldLabel = sanitizeUserInput(interaction.fields.getTextInputValue('field_label'));
    const fieldStyle = interaction.fields.getTextInputValue('field_style').toLowerCase().trim();
    const fieldRequired = interaction.fields.getTextInputValue('field_required').toLowerCase().trim();
    const fieldPlaceholder = sanitizeUserInput(interaction.fields.getTextInputValue('field_placeholder')) || undefined;

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
        content: `❌ ${config.messages.invalidId}`,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Validate field style
    if (fieldStyle !== 'short' && fieldStyle !== 'paragraph') {
      await interaction.reply({
        content: `❌ ${config.messages.invalidStyle}`,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Validate required field
    const required = fieldRequired === 'yes' || fieldRequired === 'y' || fieldRequired === 'true';

    const fields = entity.customFields || [];

    // Check for duplicate field ID
    if (fields.some(f => f.id === fieldId)) {
      await interaction.reply({
        content: `❌ ${config.messages.duplicateId}`,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Check field limit
    if (fields.length >= MAX.CUSTOM_FIELDS_PER_ENTITY) {
      await interaction.reply({
        content: `❌ ${config.messages.maxReached}`,
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
      maxLength: fieldStyle === 'short' ? TEXT_LIMITS.SHORT_FIELD : TEXT_LIMITS.PARAGRAPH_FIELD,
    };

    fields.push(newField);
    entity.customFields = fields;
    await config.saveEntity(entity);

    // Clear the cache on success
    fieldDraftCache.delete(cacheKey);

    enhancedLogger.info(`Field added to ${config.entityLabel}: ${entityId}`, LogCategory.COMMAND_EXECUTION, {
      guildId,
      entityId,
      fieldId,
    });

    await interaction.deferUpdate();
    await showFieldManager(interaction, entity, config);
  } catch (error) {
    await handleInteractionError(interaction, error, 'handleAddFieldModal');
  }
}

/**
 * Show select menu to choose a field (for delete or edit)
 */
async function showFieldSelectMenu<T extends FieldBearingEntity>(
  interaction: ButtonInteraction,
  entity: T,
  config: FieldManagerConfig<T>,
  action: 'delete' | 'edit',
): Promise<void> {
  const fields = entity.customFields || [];
  const entityId = config.getEntityId(entity);
  const { prefix } = config;

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`${prefix}${action}_select_${entityId}`)
    .setPlaceholder(LANGF(fm.selectFieldPlaceholder, action))
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
    new ButtonBuilder().setCustomId(`${prefix}cancel_${entityId}`).setLabel(btn.cancel).setStyle(ButtonStyle.Secondary),
  );

  await interaction.update({
    content: action === 'delete' ? `🗑️ ${fm.selectFieldToDelete}` : `📝 ${fm.selectFieldToEdit}`,
    embeds: [],
    components: [row, cancelButton],
  });
}

/**
 * Show reorder interface with up/down buttons for each field
 */
async function showReorderInterface<T extends FieldBearingEntity>(
  interaction: ButtonInteraction,
  entity: T,
  config: FieldManagerConfig<T>,
): Promise<void> {
  const fields = entity.customFields || [];
  const entityId = config.getEntityId(entity);
  const { prefix } = config;

  const embed = new EmbedBuilder()
    .setTitle(`🔀 ${LANGF(fm.reorderTitle, config.getDisplayTitle(entity).replace(/^🔧\s*/, ''))}`)
    .setColor(config.getEmbedColor(entity))
    .setDescription(
      `**${fm.currentOrder}**\n` +
        fields
          .map((f, i) => `${i + 1}. **${f.label}** (${f.style}${f.required ? ', required' : ', optional'})`)
          .join('\n') +
        `\n\n*${fm.reorderHint}*`,
    );

  const components: ActionRowBuilder<ButtonBuilder>[] = [];

  for (let i = 0; i < fields.length; i++) {
    const row = new ActionRowBuilder<ButtonBuilder>();

    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${prefix}moveup_${i}_${entityId}`)
        .setLabel('↑')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(i === 0),
    );

    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${prefix}label_${i}_${entityId}`)
        .setLabel(`${i + 1}. ${fields[i].label}`)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true),
    );

    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${prefix}movedown_${i}_${entityId}`)
        .setLabel('↓')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(i === fields.length - 1),
    );

    // Merge Done button into last field's row to stay within 5 action rows
    if (i === fields.length - 1) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`${prefix}reorder_done_${entityId}`)
          .setLabel(btn.done)
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
async function showModalPreview<T extends FieldBearingEntity>(
  interaction: ButtonInteraction,
  entity: T,
  config: FieldManagerConfig<T>,
): Promise<void> {
  const fields = entity.customFields || [];
  const entityId = config.getEntityId(entity);
  const { prefix } = config;

  if (fields.length === 0) {
    await interaction.reply({
      content: `❌ ${fm.noFieldsToPreview}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const modal = new ModalBuilder().setCustomId(`${prefix}preview_modal_${entityId}`).setTitle(
    config
      .getDisplayTitle(entity)
      .replace(/^🔧\s*/, '')
      .substring(0, 45),
  );

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
 * Handle field deletion
 */
async function handleDeleteField<T extends FieldBearingEntity>(
  interaction: StringSelectMenuInteraction,
  entity: T,
  config: FieldManagerConfig<T>,
): Promise<void> {
  const fieldId = interaction.values[0];
  const fields = entity.customFields || [];
  const fieldIndex = fields.findIndex(f => f.id === fieldId);

  if (fieldIndex === -1) {
    await interaction.reply({
      content: `❌ ${config.messages.fieldNotFound}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  fields.splice(fieldIndex, 1);
  entity.customFields = fields;
  await config.saveEntity(entity);

  enhancedLogger.info(
    `Field deleted from ${config.entityLabel}: ${config.getEntityId(entity)}`,
    LogCategory.COMMAND_EXECUTION,
    {
      guildId: entity.guildId,
      entityId: config.getEntityId(entity),
      fieldId,
    },
  );

  await interaction.deferUpdate();
  await showFieldManager(interaction, entity, config);
}

/**
 * Handle moving a field up or down
 */
async function handleMoveField<T extends FieldBearingEntity>(
  interaction: ButtonInteraction,
  direction: 'up' | 'down',
  fieldIndex: number,
  entity: T,
  config: FieldManagerConfig<T>,
): Promise<void> {
  const fields = entity.customFields || [];

  if (fieldIndex < 0 || fieldIndex >= fields.length) {
    await interaction.followUp({
      content: `❌ ${fm.invalidFieldIndex}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const newIndex = direction === 'up' ? fieldIndex - 1 : fieldIndex + 1;

  if (newIndex < 0 || newIndex >= fields.length) {
    await interaction.followUp({
      content: `❌ ${LANGF(fm.cannotMoveField, direction)}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const temp = fields[fieldIndex];
  fields[fieldIndex] = fields[newIndex];
  fields[newIndex] = temp;

  entity.customFields = fields;
  await config.saveEntity(entity);

  enhancedLogger.info(
    `Field reordered in ${config.entityLabel}: ${config.getEntityId(entity)}`,
    LogCategory.COMMAND_EXECUTION,
    {
      guildId: entity.guildId,
      entityId: config.getEntityId(entity),
      fieldIndex,
      newIndex,
    },
  );

  await showReorderInterface(interaction, entity, config);
}

/**
 * Main button interaction handler (generic)
 */
export async function handleFieldButton<T extends FieldBearingEntity>(
  interaction: ButtonInteraction,
  action: string,
  entityId: string,
  config: FieldManagerConfig<T>,
): Promise<void> {
  try {
    const guildId = interaction.guildId!;

    const entity = await config.findEntity(guildId, entityId);
    if (!entity) {
      await interaction.reply({
        content: `❌ ${config.messages.notFound}`,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Check session if configured
    if (config.session) {
      const sessionStatus = config.session.check(interaction.user.id, guildId, entityId);
      if (sessionStatus !== 'active') {
        await interaction.update({
          content: sessionStatus === 'completed' ? config.session.completedMessage : config.session.expiredMessage,
          embeds: [],
          components: [],
        });
        return;
      }
    }

    switch (action) {
      case 'add':
        await showAddFieldModal(interaction, entityId, config);
        break;
      case 'edit':
        if (config.showEdit) {
          await showFieldSelectMenu(interaction, entity, config, 'edit');
        }
        break;
      case 'delete':
        await showFieldSelectMenu(interaction, entity, config, 'delete');
        break;
      case 'preview':
        await showModalPreview(interaction, entity, config);
        break;
      case 'reorder':
        await showReorderInterface(interaction, entity, config);
        break;
      case 'reorder_done':
        await showFieldManager(interaction, entity, config);
        break;
      case 'done':
        if (config.session) {
          config.session.complete(interaction.user.id, guildId, entityId);
        }
        await interaction.update({
          content: `✅ ${config.messages.fieldComplete}`,
          embeds: [],
          components: [],
        });
        break;
      case 'cancel':
        await showFieldManager(interaction, entity, config);
        break;
      default: {
        const moveUpMatch = action.match(/^moveup_(\d+)$/);
        const moveDownMatch = action.match(/^movedown_(\d+)$/);

        if (moveUpMatch) {
          const idx = parseInt(moveUpMatch[1], 10);
          await handleMoveField(interaction, 'up', idx, entity, config);
        } else if (moveDownMatch) {
          const idx = parseInt(moveDownMatch[1], 10);
          await handleMoveField(interaction, 'down', idx, entity, config);
        }
        break;
      }
    }
  } catch (error) {
    await handleInteractionError(interaction, error, 'handleFieldButton');
  }
}

/**
 * Handle field selection from select menu (generic)
 */
export async function handleFieldSelectMenu<T extends FieldBearingEntity>(
  interaction: StringSelectMenuInteraction,
  action: string,
  entityId: string,
  config: FieldManagerConfig<T>,
): Promise<void> {
  try {
    const guildId = interaction.guildId!;

    const entity = await config.findEntity(guildId, entityId);
    if (!entity) {
      await interaction.reply({
        content: `❌ ${config.messages.notFound}`,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Check session if configured
    if (config.session) {
      const sessionStatus = config.session.check(interaction.user.id, guildId, entityId);
      if (sessionStatus !== 'active') {
        await interaction.update({
          content: sessionStatus === 'completed' ? config.session.completedMessage : config.session.expiredMessage,
          embeds: [],
          components: [],
        });
        return;
      }
    }

    if (action === 'delete') {
      await handleDeleteField(interaction, entity, config);
    }
  } catch {
    await interaction
      .reply({
        content: `❌ ${fm.selectionError}`,
        flags: [MessageFlags.Ephemeral],
      })
      .catch(() => {
        // Interaction may have already been handled
      });
  }
}

/**
 * Handle preview modal submission (generic)
 */
export async function handlePreviewModal<T extends FieldBearingEntity>(
  interaction: ModalSubmitInteraction,
  config: FieldManagerConfig<T>,
): Promise<void> {
  await interaction.reply({
    content: `✅ ${config.messages.previewNote}`,
    flags: [MessageFlags.Ephemeral],
  });
}

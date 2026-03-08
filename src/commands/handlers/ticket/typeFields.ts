import {
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  MessageFlags,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { CustomTicketType } from '../../../typeorm/entities/ticket/CustomTicketType';
import { enhancedLogger, handleInteractionError, LogCategory, lang } from '../../../utils';
import {
  handleAddFieldModal as coreHandleAddFieldModal,
  handleFieldButton as coreHandleFieldButton,
  handleFieldSelectMenu as coreHandleFieldSelectMenu,
  handlePreviewModal as coreHandlePreviewModal,
  type FieldManagerConfig,
  showFieldManager,
} from '../shared/fieldManagerCore';

const typeRepo = AppDataSource.getRepository(CustomTicketType);

/** Config for ticket type field manager */
const ticketFieldConfig: FieldManagerConfig<CustomTicketType> = {
  prefix: 'field_',
  entityLabel: 'ticket type',
  getDisplayTitle: t => `🔧 Configure Fields: ${t.emoji || '📋'} ${t.displayName}`,
  getEmbedColor: t => parseInt(t.embedColor.replace('#', ''), 16),
  getFooterText: t => `Type ID: ${t.typeId}`,
  getEntityId: t => t.typeId,
  findEntity: async (guildId, entityId) => {
    return typeRepo.findOne({ where: { guildId, typeId: entityId } });
  },
  saveEntity: async t => {
    await typeRepo.save(t);
  },
  messages: {
    notFound: 'Ticket type not found!',
    noFields: 'No fields configured. Add fields to customize the ticket form.',
    fieldComplete: 'Field configuration complete!',
    previewNote: 'This was just a preview! The modal works correctly.',
    invalidId: 'Field ID must contain only lowercase letters, numbers, and underscores!',
    invalidStyle: 'Field style must be either "short" or "paragraph"!',
    duplicateId: 'A field with that ID already exists!',
    maxReached: 'Maximum 5 fields per ticket type (Discord limitation)!',
    fieldNotFound: 'Field not found!',
  },
  showEdit: true,
};

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

    await showFieldManager(interaction, ticketType, ticketFieldConfig);
  } catch (error) {
    await handleInteractionError(interaction, error, 'typeFieldsHandler');
  }
}

/**
 * Handle add field modal submission
 */
export async function handleAddFieldModal(
  interaction: ModalSubmitInteraction,
  typeId: string,
): Promise<void> {
  await coreHandleAddFieldModal(interaction, typeId, ticketFieldConfig);
}

/**
 * Handle preview modal submission (just dismiss it)
 */
export async function handlePreviewModal(
  interaction: ModalSubmitInteraction,
  _typeId: string,
): Promise<void> {
  await coreHandlePreviewModal(interaction, ticketFieldConfig);
}

/**
 * Main button interaction handler
 */
export async function handleFieldButton(
  interaction: ButtonInteraction,
  action: string,
  typeId: string,
): Promise<void> {
  await coreHandleFieldButton(interaction, action, typeId, ticketFieldConfig);
}

/**
 * Handle field selection for delete
 */
export async function handleFieldSelectMenu(
  interaction: StringSelectMenuInteraction,
  action: string,
  typeId: string,
): Promise<void> {
  await coreHandleFieldSelectMenu(interaction, action, typeId, ticketFieldConfig);
}

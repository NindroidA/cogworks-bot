import { type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { CustomTicketType } from '../../../typeorm/entities/ticket/CustomTicketType';
import { enhancedLogger, guardFeatureAccess, handleInteractionError, LogCategory } from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { createFieldHandlers, type FieldManagerConfig } from '../shared/fieldManagerCore';

const typeRepo = lazyRepo(CustomTicketType);

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

const fields = createFieldHandlers(ticketFieldConfig);
export const { handleAddFieldModal, handleFieldButton, handleFieldSelectMenu, handlePreviewModal } = fields;

/**
 * Handler for /ticket type-fields command
 * Interactive UI for managing custom input fields
 */
export async function typeFieldsHandler(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    const guard = await guardFeatureAccess(interaction, 'tickets', 'manage');
    if (!guard.allowed) return;

    const guildId = interaction.guildId!;
    const typeId = interaction.options.getString('type', true);

    enhancedLogger.debug(`Command: /ticket type-fields type=${typeId}`, LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      guildId,
      typeId,
    });

    const ticketType = await typeRepo.findOne({
      where: { guildId, typeId },
    });

    if (!ticketType) {
      enhancedLogger.warn(`Type-fields: type '${typeId}' not found`, LogCategory.COMMAND_EXECUTION, {
        userId: interaction.user.id,
        guildId,
        typeId,
      });
      await interaction.reply({
        content: '❌ Ticket type not found!',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    await fields.showFieldManager(interaction, ticketType);
  } catch (error) {
    await handleInteractionError(interaction, error, 'typeFieldsHandler');
  }
}

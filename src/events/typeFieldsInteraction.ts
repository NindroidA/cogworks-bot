import type { ButtonInteraction, Client, Interaction, StringSelectMenuInteraction } from 'discord.js';
import {
  handleAddFieldModal,
  handleFieldButton,
  handleFieldSelectMenu,
  handlePreviewModal,
} from '../commands/handlers/ticket/typeFields';
import { enhancedLogger, LogCategory } from '../utils';

/**
 * Event handler for type-fields interactions (buttons, select menus, modals).
 * Returns `true` if the interaction was matched + handled, `false` otherwise.
 * The top-level router uses this to know when to stop trying further handlers.
 */
export const typeFieldsInteraction = async (_client: Client, interaction: Interaction): Promise<boolean> => {
  if (!interaction.guildId) return false;
  const guildId = interaction.guildId;

  try {
    if (interaction.isButton()) {
      const customId = interaction.customId;
      if (!customId.startsWith('field_')) return false;

      enhancedLogger.debug(`Button: ${customId}`, LogCategory.COMMAND_EXECUTION, {
        userId: interaction.user.id,
        guildId,
        customId,
      });

      // Move buttons: field_moveup_<index>_<typeId> | field_movedown_<index>_<typeId>
      const moveMatch = customId.match(/^field_(moveup|movedown)_(\d+)_(.+)$/);
      if (moveMatch) {
        const [, direction, index, typeId] = moveMatch;
        await handleFieldButton(interaction as ButtonInteraction, `${direction}_${index}`, typeId);
        return true;
      }

      // Reorder-done: field_reorder_done_<typeId>
      const reorderDoneMatch = customId.match(/^field_reorder_done_(.+)$/);
      if (reorderDoneMatch) {
        await handleFieldButton(interaction as ButtonInteraction, 'reorder_done', reorderDoneMatch[1]);
        return true;
      }

      // Generic field buttons: field_<action>_<typeId>
      const fieldButtonMatch = customId.match(/^field_([^_]+)_(.+)$/);
      if (fieldButtonMatch) {
        const [, action, typeId] = fieldButtonMatch;
        await handleFieldButton(interaction as ButtonInteraction, action, typeId);
        return true;
      }
      return false;
    }

    if (interaction.isStringSelectMenu()) {
      const customId = interaction.customId;
      if (!customId.startsWith('field_')) return false;

      enhancedLogger.debug(`Select: ${customId}`, LogCategory.COMMAND_EXECUTION, {
        userId: interaction.user.id,
        guildId,
        customId,
      });

      const fieldSelectMatch = customId.match(/^field_([^_]+)_select_(.+)$/);
      if (fieldSelectMatch) {
        const [, action, typeId] = fieldSelectMatch;
        await handleFieldSelectMenu(interaction as StringSelectMenuInteraction, action, typeId);
        return true;
      }
      return false;
    }

    if (interaction.isModalSubmit()) {
      const customId = interaction.customId;
      if (!customId.startsWith('field_')) return false;

      enhancedLogger.debug(`Modal submit: ${customId}`, LogCategory.COMMAND_EXECUTION, {
        userId: interaction.user.id,
        guildId,
        customId,
      });

      const addFieldMatch = customId.match(/^field_add_modal_(.+)$/);
      if (addFieldMatch) {
        await handleAddFieldModal(interaction, addFieldMatch[1]);
        return true;
      }

      if (customId.match(/^field_preview_modal_(.+)$/)) {
        await handlePreviewModal(interaction);
        return true;
      }
      return false;
    }
  } catch (error) {
    enhancedLogger.error(
      'Error in typeFieldsInteraction event',
      error instanceof Error ? error : new Error(String(error)),
      LogCategory.COMMAND_EXECUTION,
      { userId: interaction.user.id, guildId },
    );
    return true; // we tried; don't fall through to other handlers
  }

  return false;
};

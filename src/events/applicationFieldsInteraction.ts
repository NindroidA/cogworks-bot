import type { ButtonInteraction, Client, Interaction, StringSelectMenuInteraction } from 'discord.js';
import { applicationEditModalHandler } from '../commands/handlers/application/applicationEdit';
import {
  handleAppAddFieldModal,
  handleAppFieldButton,
  handleAppFieldSelectMenu,
  handleAppPreviewModal,
} from '../commands/handlers/application/applicationFields';
import { enhancedLogger, LogCategory } from '../utils';

/**
 * Event handler for application field interactions (buttons, select menus, modals).
 * Uses `appfield_` prefix (and `application-position-edit-modal:`) to avoid
 * collision with ticket `field_` prefix. Returns `true` if the interaction was
 * matched + handled, `false` otherwise.
 */
export const applicationFieldsInteraction = async (_client: Client, interaction: Interaction): Promise<boolean> => {
  if (!interaction.guildId) return false;
  const guildId = interaction.guildId;

  try {
    if (interaction.isButton()) {
      const customId = interaction.customId;
      if (!customId.startsWith('appfield_')) return false;

      // Move buttons: appfield_moveup_<index>_<positionId> | appfield_movedown_<index>_<positionId>
      const moveMatch = customId.match(/^appfield_(moveup|movedown)_(\d+)_(\d+)$/);
      if (moveMatch) {
        const [, direction, index, positionId] = moveMatch;
        await handleAppFieldButton(interaction as ButtonInteraction, `${direction}_${index}`, positionId);
        return true;
      }

      // Reorder-done: appfield_reorder_done_<positionId>
      const reorderDoneMatch = customId.match(/^appfield_reorder_done_(\d+)$/);
      if (reorderDoneMatch) {
        await handleAppFieldButton(interaction as ButtonInteraction, 'reorder_done', reorderDoneMatch[1]);
        return true;
      }

      // Generic field buttons: appfield_<action>_<positionId> — skip label_ buttons
      const fieldButtonMatch = customId.match(/^appfield_([^_]+)_(\d+)$/);
      if (fieldButtonMatch) {
        const [, action, positionId] = fieldButtonMatch;
        if (action !== 'label') {
          await handleAppFieldButton(interaction as ButtonInteraction, action, positionId);
        }
        return true;
      }
      return false;
    }

    if (interaction.isStringSelectMenu()) {
      const customId = interaction.customId;
      if (!customId.startsWith('appfield_')) return false;

      const fieldSelectMatch = customId.match(/^appfield_([^_]+)_select_(\d+)$/);
      if (fieldSelectMatch) {
        const [, action, positionId] = fieldSelectMatch;
        await handleAppFieldSelectMenu(interaction as StringSelectMenuInteraction, action, positionId);
        return true;
      }
      return false;
    }

    if (interaction.isModalSubmit()) {
      const customId = interaction.customId;

      const addFieldMatch = customId.match(/^appfield_add_modal_(\d+)$/);
      if (addFieldMatch) {
        await handleAppAddFieldModal(interaction, addFieldMatch[1]);
        return true;
      }

      if (customId.match(/^appfield_preview_modal_(\d+)$/)) {
        await handleAppPreviewModal(interaction);
        return true;
      }

      const editMatch = customId.match(/^application-position-edit-modal:(\d+)$/);
      if (editMatch) {
        await applicationEditModalHandler(interaction, parseInt(editMatch[1], 10));
        return true;
      }
      return false;
    }
  } catch (error) {
    enhancedLogger.error(
      'Error in applicationFieldsInteraction event',
      error instanceof Error ? error : new Error(String(error)),
      LogCategory.COMMAND_EXECUTION,
      { userId: interaction.user.id, guildId },
    );
    return true;
  }

  return false;
};

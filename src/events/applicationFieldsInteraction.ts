import type {
  ButtonInteraction,
  Client,
  Interaction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { applicationEditModalHandler } from '../commands/handlers/application/applicationEdit';
import {
  handleAppAddFieldModal,
  handleAppFieldButton,
  handleAppFieldSelectMenu,
  handleAppPreviewModal,
} from '../commands/handlers/application/applicationFields';
import { enhancedLogger, LogCategory } from '../utils';

/**
 * Event handler for application field interactions (buttons, select menus, modals)
 * Uses `appfield_` prefix to avoid collision with ticket `field_` prefix
 */
export const applicationFieldsInteraction = async (_client: Client, interaction: Interaction) => {
  const guildId = interaction.guildId || '';

  try {
    // Handle button interactions for field management
    if (interaction.isButton()) {
      const customId = interaction.customId;

      // Check if this is an application field management button
      // Pattern: appfield_action_positionId
      // Special patterns:
      //   - appfield_moveup_index_positionId or appfield_movedown_index_positionId
      //   - appfield_reorder_done_positionId

      // Try to match move buttons first (appfield_moveup_0_123 or appfield_movedown_0_123)
      const moveMatch = customId.match(/^appfield_(moveup|movedown)_(\d+)_(\d+)$/);
      if (moveMatch) {
        const [, direction, index, positionId] = moveMatch;
        const action = `${direction}_${index}`;
        await handleAppFieldButton(
          interaction as ButtonInteraction,
          action,
          parseInt(positionId, 10),
        );
        return;
      }

      // Try to match reorder_done button (appfield_reorder_done_123)
      const reorderDoneMatch = customId.match(/^appfield_reorder_done_(\d+)$/);
      if (reorderDoneMatch) {
        const positionId = parseInt(reorderDoneMatch[1], 10);
        await handleAppFieldButton(interaction as ButtonInteraction, 'reorder_done', positionId);
        return;
      }

      // Regular field buttons (appfield_action_positionId) — but skip label_ buttons
      const fieldButtonMatch = customId.match(/^appfield_([^_]+)_(\d+)$/);
      if (fieldButtonMatch) {
        const [, action, positionId] = fieldButtonMatch;
        if (action !== 'label') {
          await handleAppFieldButton(
            interaction as ButtonInteraction,
            action,
            parseInt(positionId, 10),
          );
        }
        return;
      }
    }

    // Handle select menu interactions for field deleting
    if (interaction.isStringSelectMenu()) {
      const customId = interaction.customId;

      // Pattern: appfield_action_select_positionId (e.g., appfield_delete_select_123)
      const fieldSelectMatch = customId.match(/^appfield_([^_]+)_select_(\d+)$/);
      if (fieldSelectMatch) {
        const [, action, positionId] = fieldSelectMatch;
        await handleAppFieldSelectMenu(
          interaction as StringSelectMenuInteraction,
          action,
          parseInt(positionId, 10),
        );
        return;
      }
    }

    // Handle modal submissions for field management and position editing
    if (interaction.isModalSubmit()) {
      const customId = interaction.customId;

      // Check if this is an add field modal
      const addFieldMatch = customId.match(/^appfield_add_modal_(\d+)$/);
      if (addFieldMatch) {
        const positionId = parseInt(addFieldMatch[1], 10);
        await handleAppAddFieldModal(interaction, positionId);
        return;
      }

      // Check if this is a preview modal
      const previewMatch = customId.match(/^appfield_preview_modal_(\d+)$/);
      if (previewMatch) {
        await handleAppPreviewModal(interaction);
        return;
      }

      // Check if this is a position edit modal
      const editMatch = customId.match(/^application-position-edit-modal:(\d+)$/);
      if (editMatch) {
        const positionId = parseInt(editMatch[1], 10);
        await applicationEditModalHandler(interaction, positionId);
        return;
      }
    }
  } catch (error) {
    enhancedLogger.error(
      'Error in applicationFieldsInteraction event',
      error instanceof Error ? error : new Error(String(error)),
      LogCategory.COMMAND_EXECUTION,
      { userId: interaction.user.id, guildId },
    );
  }
};

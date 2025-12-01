import { ButtonInteraction, Client, Interaction, StringSelectMenuInteraction } from 'discord.js';
import { handleAddFieldModal, handleFieldButton, handleFieldSelectMenu, handlePreviewModal } from '../commands/handlers/ticket/typeFields';
import { logger } from '../utils';

/**
 * Event handler for type-fields interactions (buttons, select menus, modals)
 */
export const typeFieldsInteraction = async (client: Client, interaction: Interaction) => {
    try {
        // Handle button interactions for field management
        if (interaction.isButton()) {
            const customId = interaction.customId;
            
            // Check if this is a field management button
            // Pattern: field_action_typeId (e.g., field_add_my-type-id)
            // Special patterns: 
            //   - field_moveup_index_typeId or field_movedown_index_typeId
            //   - field_reorder_done_typeId
            
            // Try to match move buttons first (field_moveup_0_typeId or field_movedown_0_typeId)
            const moveMatch = customId.match(/^field_(moveup|movedown)_(\d+)_(.+)$/);
            if (moveMatch) {
                const [, direction, index, typeId] = moveMatch;
                const action = `${direction}_${index}`;
                await handleFieldButton(interaction as ButtonInteraction, action, typeId);
                return;
            }

            // Try to match reorder_done button (field_reorder_done_typeId)
            const reorderDoneMatch = customId.match(/^field_reorder_done_(.+)$/);
            if (reorderDoneMatch) {
                const typeId = reorderDoneMatch[1];
                await handleFieldButton(interaction as ButtonInteraction, 'reorder_done', typeId);
                return;
            }
            
            // Regular field buttons (field_action_typeId)
            const fieldButtonMatch = customId.match(/^field_([^_]+)_(.+)$/);
            if (fieldButtonMatch) {
                const [, action, typeId] = fieldButtonMatch;
                await handleFieldButton(interaction as ButtonInteraction, action, typeId);
                return;
            }
        }

        // Handle select menu interactions for field editing/deleting
        if (interaction.isStringSelectMenu()) {
            const customId = interaction.customId;
            
            // Check if this is a field select menu
            // Pattern: field_action_select_typeId (e.g., field_edit_select_my-type-id)
            const fieldSelectMatch = customId.match(/^field_([^_]+)_select_(.+)$/);
            if (fieldSelectMatch) {
                const [, action, typeId] = fieldSelectMatch;
                await handleFieldSelectMenu(interaction as StringSelectMenuInteraction, action, typeId);
                return;
            }
        }

        // Handle modal submissions for field management
        if (interaction.isModalSubmit()) {
            const customId = interaction.customId;
            
            // Check if this is an add field modal
            const addFieldMatch = customId.match(/^field_add_modal_(.+)$/);
            if (addFieldMatch) {
                const typeId = addFieldMatch[1];
                await handleAddFieldModal(interaction, typeId);
                return;
            }

            // Check if this is a preview modal
            const previewMatch = customId.match(/^field_preview_modal_(.+)$/);
            if (previewMatch) {
                const typeId = previewMatch[1];
                await handlePreviewModal(interaction, typeId);
                return;
            }
        }

    } catch (error) {
        logger(`Error in typeFieldsInteraction event: ${(error as Error).message}`, 'ERROR');
        logger((error as Error).stack || 'No stack trace', 'ERROR');
    }
};

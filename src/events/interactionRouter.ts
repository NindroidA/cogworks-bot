/**
 * Centralized Interaction Router
 *
 * Dispatches button, select menu, and modal interactions to the correct
 * feature handler based on customId prefix. Replaces the previous pattern
 * where all four handlers received every interaction via client.emit().
 */

import type { Client, Interaction } from 'discord.js';
import { applicationFieldsInteraction } from './applicationFieldsInteraction';
import { handleApplicationInteraction } from './applicationInteraction';
import { handleTicketInteraction } from './ticketInteraction';
import { typeFieldsInteraction } from './typeFieldsInteraction';

/**
 * Routes an interaction to the appropriate feature handler.
 *
 * Routing rules (checked in order):
 *
 * **typeFieldsInteraction** — `field_*` prefix (ticket type field management)
 * **applicationFieldsInteraction** — `appfield_*` prefix, `application-position-edit-modal:*`
 * **applicationInteraction** — `apply_*`, `age_verify_*`, `cancel_application`,
 *   `close_application`, `confirm_close_application`, `cancel_close_application`,
 *   `application_modal_*`
 * **ticketInteraction** — `create_ticket`, `cancel_ticket`, `close_ticket`,
 *   `confirm_close_ticket`, `cancel_close_ticket`, `admin_only_ticket`,
 *   `confirm_admin_only_ticket`, `cancel_admin_only_ticket`,
 *   `ticket_type_ping_toggle:*`, `ticket_type_select`, `ticket-type-add-modal`,
 *   `ticket-type-edit-modal:*`, `ticket-email-import-modal`
 */
export const routeInteraction = async (client: Client, interaction: Interaction): Promise<void> => {
  if (
    !interaction.isButton() &&
    !interaction.isStringSelectMenu() &&
    !interaction.isModalSubmit()
  ) {
    return;
  }

  const customId = interaction.customId;

  // --- Field management (ticket types) ---
  if (customId.startsWith('field_')) {
    return typeFieldsInteraction(client, interaction);
  }

  // --- Field management (application positions) + position edit modal ---
  if (customId.startsWith('appfield_') || customId.startsWith('application-position-edit-modal:')) {
    return applicationFieldsInteraction(client, interaction);
  }

  // --- Application system ---
  if (
    customId.startsWith('apply_') ||
    customId.startsWith('age_verify_') ||
    customId.startsWith('application_modal_') ||
    customId === 'cancel_application' ||
    customId === 'close_application' ||
    customId === 'confirm_close_application' ||
    customId === 'cancel_close_application'
  ) {
    return handleApplicationInteraction(client, interaction);
  }

  // --- Ticket system ---
  // Covers: create_ticket, cancel_ticket, close_ticket, confirm_close_ticket,
  // cancel_close_ticket, admin_only_ticket, confirm_admin_only_ticket,
  // cancel_admin_only_ticket, ticket_* (legacy type buttons), ticket_modal_*,
  // ticket_type_select, ticket_type_ping_toggle:*, ticket-type-add-modal,
  // ticket-type-edit-modal:*, ticket-email-import-modal
  if (
    customId.startsWith('ticket_') ||
    customId.startsWith('ticket-') ||
    customId === 'create_ticket' ||
    customId === 'cancel_ticket' ||
    customId === 'close_ticket' ||
    customId === 'confirm_close_ticket' ||
    customId === 'cancel_close_ticket' ||
    customId === 'admin_only_ticket' ||
    customId === 'confirm_admin_only_ticket' ||
    customId === 'cancel_admin_only_ticket'
  ) {
    return handleTicketInteraction(client, interaction);
  }

  // Unmatched interactions are silently ignored — they may belong to
  // collector-based flows (e.g., bot-setup wizard, reaction role setup)
  // which handle their own interactions via message component collectors.
};

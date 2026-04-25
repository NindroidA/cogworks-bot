import type {
  ButtonInteraction,
  Client,
  Interaction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { emailImportModalHandler } from '../../commands/handlers/ticket/emailImport';
import { typeAddModalHandler } from '../../commands/handlers/ticket/typeAdd';
import { typeEditModalHandler } from '../../commands/handlers/ticket/typeEdit';
import { adminOnlyButton, cancelAdminOnly, confirmAdminOnly } from './adminOnly';
import { cancelClose, closeButton, confirmClose } from './close';
import {
  cancelTicketButton,
  createTicketButton,
  legacyTicketTypeButton,
  selectTicketType,
  submitTicketModal,
} from './create';
import { pingToggleButton } from './typeAdmin';

type ButtonHandler = (client: Client, interaction: ButtonInteraction) => Promise<void>;
type ModalHandler = (client: Client, interaction: ModalSubmitInteraction) => Promise<void>;
type SelectHandler = (client: Client, interaction: StringSelectMenuInteraction) => Promise<void>;

const BUTTON_ROUTES: Record<string, ButtonHandler> = {
  create_ticket: createTicketButton,
  cancel_ticket: cancelTicketButton,
  admin_only_ticket: adminOnlyButton,
  confirm_admin_only_ticket: confirmAdminOnly,
  cancel_admin_only_ticket: cancelAdminOnly,
  close_ticket: closeButton,
  confirm_close_ticket: confirmClose,
  cancel_close_ticket: cancelClose,
};

const MODAL_ROUTES: Record<string, ModalHandler> = {
  'ticket-type-add-modal': (_client, interaction) => typeAddModalHandler(interaction),
  'ticket-email-import-modal': (_client, interaction) => emailImportModalHandler(interaction),
};

const SELECT_ROUTES: Record<string, SelectHandler> = {
  ticket_type_select: selectTicketType,
};

interface PrefixRoute<H> {
  prefix: string;
  handler: H;
}

/**
 * Order matters — `ticket_modal_` and `ticket_type_ping_toggle:` must match
 * before the catch-all `ticket_` legacy-type prefix would have a chance.
 * The catch-all is button-only and validates with `isLegacyTicketType`.
 */
const BUTTON_PREFIX_ROUTES: PrefixRoute<ButtonHandler>[] = [
  { prefix: 'ticket_type_ping_toggle:', handler: pingToggleButton },
  { prefix: 'ticket_', handler: legacyTicketTypeButton },
];

const MODAL_PREFIX_ROUTES: PrefixRoute<ModalHandler>[] = [
  {
    prefix: 'ticket-type-edit-modal:',
    handler: (_client, interaction) =>
      typeEditModalHandler(interaction, interaction.customId.replace('ticket-type-edit-modal:', '')),
  },
  { prefix: 'ticket_modal_', handler: submitTicketModal },
];

export const dispatchTicketInteraction = async (client: Client, interaction: Interaction): Promise<boolean> => {
  if (interaction.isButton()) {
    const exact = BUTTON_ROUTES[interaction.customId];
    if (exact) {
      await exact(client, interaction);
      return true;
    }
    for (const route of BUTTON_PREFIX_ROUTES) {
      if (interaction.customId.startsWith(route.prefix)) {
        await route.handler(client, interaction);
        return true;
      }
    }
    return false;
  }

  if (interaction.isModalSubmit()) {
    const exact = MODAL_ROUTES[interaction.customId];
    if (exact) {
      await exact(client, interaction);
      return true;
    }
    for (const route of MODAL_PREFIX_ROUTES) {
      if (interaction.customId.startsWith(route.prefix)) {
        await route.handler(client, interaction);
        return true;
      }
    }
    return false;
  }

  if (interaction.isStringSelectMenu()) {
    const handler = SELECT_ROUTES[interaction.customId];
    if (handler) {
      await handler(client, interaction);
      return true;
    }
  }

  return false;
};

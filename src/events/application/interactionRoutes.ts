import type { ButtonInteraction, Client, Interaction, ModalSubmitInteraction } from 'discord.js';
import {
  ageVerifyNoButton,
  ageVerifyYesButton,
  applyButton,
  cancelApplicationButton,
  submitApplicationModal,
} from './apply';
import { cancelCloseApplication, closeApplicationButton, confirmCloseApplication } from './close';

type ButtonHandler = (client: Client, interaction: ButtonInteraction) => Promise<void>;
type ModalHandler = (client: Client, interaction: ModalSubmitInteraction) => Promise<void>;

const BUTTON_ROUTES: Record<string, ButtonHandler> = {
  cancel_application: cancelApplicationButton,
  close_application: closeApplicationButton,
  confirm_close_application: confirmCloseApplication,
  cancel_close_application: cancelCloseApplication,
};

interface PrefixRoute<H> {
  prefix: string;
  handler: H;
}

/**
 * Order matters — `age_verify_yes_` and `age_verify_no_` are not prefixes
 * of `apply_`, so order is only meaningful within shared prefix families.
 * `apply_` is last as a defensive default.
 */
const BUTTON_PREFIX_ROUTES: PrefixRoute<ButtonHandler>[] = [
  { prefix: 'age_verify_yes_', handler: ageVerifyYesButton },
  { prefix: 'age_verify_no_', handler: ageVerifyNoButton },
  { prefix: 'apply_', handler: applyButton },
];

const MODAL_PREFIX_ROUTES: PrefixRoute<ModalHandler>[] = [
  { prefix: 'application_modal_', handler: submitApplicationModal },
];

export const dispatchApplicationInteraction = async (client: Client, interaction: Interaction): Promise<boolean> => {
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
    for (const route of MODAL_PREFIX_ROUTES) {
      if (interaction.customId.startsWith(route.prefix)) {
        await route.handler(client, interaction);
        return true;
      }
    }
  }

  return false;
};

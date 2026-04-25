/**
 * Modal Show + Await Helper
 *
 * Wraps the common pattern of showModal → awaitModalSubmit → notifyModalTimeout
 * into a single function call. Returns the ModalSubmitInteraction or null on timeout.
 */

import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  ContextMenuCommandInteraction,
  MessageComponentInteraction,
  ModalBuilder,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { notifyModalTimeout } from '../collectors';
import { TIMEOUTS } from '../constants';

type ModalSourceInteraction =
  | ChatInputCommandInteraction
  | ButtonInteraction
  | StringSelectMenuInteraction
  | MessageComponentInteraction
  | ContextMenuCommandInteraction;

/**
 * Raw modal object shape produced by `rawModal()` in `utils/modalComponents.ts`.
 * Required for new component types (label/radio/checkbox) that discord.js
 * v14.25.1's `ModalBuilder` does not yet type.
 */
interface RawModalObject {
  custom_id: string;
  title: string;
  components: unknown[];
}

/**
 * Show a modal and await its submission.
 * Automatically notifies the user on timeout via `notifyModalTimeout`.
 * Returns the ModalSubmitInteraction or null if timed out.
 *
 * Accepts `ModalBuilder` (classic text-input modals) or a raw modal object
 * from `rawModal()` (new-component modals). Callers with raw objects no longer
 * need a `modal as any` cast.
 *
 * @example
 * const submit = await showAndAwaitModal(interaction, modal);
 * if (!submit) return;
 * const name = submit.fields.getTextInputValue('name');
 */
export async function showAndAwaitModal(
  interaction: ModalSourceInteraction,
  modal: ModalBuilder | RawModalObject,
  timeout = TIMEOUTS.MODAL,
): Promise<ModalSubmitInteraction | null> {
  // discord.js v14.25.1 doesn't yet type the new label/radio/checkbox
  // components; the runtime accepts the raw shape so we cast internally
  // and present a clean typed signature to callers.
  await interaction.showModal(modal as ModalBuilder);

  const submit = await interaction.awaitModalSubmit({ time: timeout }).catch(async () => {
    await notifyModalTimeout(interaction);
    return null;
  });

  return submit;
}

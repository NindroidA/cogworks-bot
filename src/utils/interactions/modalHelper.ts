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
 * Show a modal and await its submission.
 * Automatically notifies the user on timeout via `notifyModalTimeout`.
 * Returns the ModalSubmitInteraction or null if timed out.
 *
 * @example
 * const submit = await showAndAwaitModal(interaction, modal);
 * if (!submit) return;
 * const name = submit.fields.getTextInputValue('name');
 */
export async function showAndAwaitModal(
  interaction: ModalSourceInteraction,
  modal: ModalBuilder,
  timeout = TIMEOUTS.MODAL,
): Promise<ModalSubmitInteraction | null> {
  await interaction.showModal(modal);

  const submit = await interaction.awaitModalSubmit({ time: timeout }).catch(async () => {
    await notifyModalTimeout(interaction);
    return null;
  });

  return submit;
}

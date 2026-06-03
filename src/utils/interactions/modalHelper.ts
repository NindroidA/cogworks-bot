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
  ModalSubmitFields,
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

  // Filter on customId so we only resolve for THIS modal's submission. Without
  // this, awaitModalSubmit catches the next modal the user submits from any
  // surface — e.g. dismissing our edit modal and then submitting a ticket-
  // create modal would wrongly route that submission back here.
  const customId = extractCustomId(modal);
  const submit = await interaction
    .awaitModalSubmit({
      time: timeout,
      filter: i => i.customId === customId && i.user.id === interaction.user.id,
    })
    .catch(async () => {
      await notifyModalTimeout(interaction);
      return null;
    });

  return submit;
}

function extractCustomId(modal: ModalBuilder | RawModalObject): string {
  // ModalBuilder stores it on `.data.custom_id`; rawModal() stores it on
  // `.custom_id` directly. Probe both — discord.js doesn't expose a uniform
  // accessor across the legacy/new modal shapes yet.
  const m = modal as { data?: { custom_id?: string }; custom_id?: string };
  return m.data?.custom_id ?? m.custom_id ?? '';
}

/**
 * Read a single STRING value from a submitted modal's fields, tolerant of field
 * type. Text/radio inputs expose `.value`; select components expose `.values[]`.
 * Returns the first available value as a string, or undefined. Prefer this over
 * `fields.getField(id)?.value`, which silently misses selects.
 *
 * NOTE: for checkbox components use {@link extractModalBoolean} — a checkbox's
 * `.value` is a boolean, and stringifying it here would turn an unchecked box
 * into the truthy string `"false"`.
 */
export function extractModalField(fields: ModalSubmitFields, customId: string): string | undefined {
  try {
    const field = fields.getField(customId) as {
      value?: unknown;
      values?: unknown[];
    } | null;
    if (!field) return undefined;
    if (typeof field.value === 'boolean') return undefined; // use extractModalBoolean
    if (field.value !== undefined && field.value !== null) return String(field.value);
    if (Array.isArray(field.values) && field.values.length > 0) return String(field.values[0]);
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read a checkbox value from a submitted modal's fields. A checkbox component's
 * `.value` is a boolean; this coerces it safely and returns `defaultValue` when
 * the field is absent. Use this instead of `extractModalField` for checkboxes
 * (which stringifies, making an unchecked box the truthy `"false"`).
 */
export function extractModalBoolean(fields: ModalSubmitFields, customId: string, defaultValue = false): boolean {
  try {
    const field = fields.getField(customId) as { value?: unknown } | null;
    if (!field || field.value === undefined || field.value === null) return defaultValue;
    return Boolean(field.value);
  } catch {
    return defaultValue;
  }
}

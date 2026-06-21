/**
 * Await a single string-select choice from an already-sent ephemeral message.
 *
 * Collapses the repeated `response.awaitMessageComponent({ filter, time })`
 * plus the surrounding try/catch that several handlers hand-roll for a
 * one-shot picker. Returns the select interaction (the caller reads `.values`
 * and issues its own `.update`), or `null` when the user makes no choice before
 * the timeout — in which case the original reply is edited with the standard
 * timeout message.
 *
 * For stateful multi-step component flows (live-updating menus, confirm chains)
 * use the event-based collectors in `utils/collectors.ts` instead — this is the
 * one-and-done case only.
 */
import type {
  ChatInputCommandInteraction,
  InteractionResponse,
  Message,
  StringSelectMenuInteraction,
} from 'discord.js';
import { lang } from '../../lang';
import { TIMEOUTS } from '../constants';

export interface SelectMenuChoiceOptions {
  /** Only this user may resolve the menu. */
  userId: string;
  /** The select menu's customId to filter on. */
  customId: string;
  /** Await timeout in ms. Defaults to {@link TIMEOUTS.SELECT_MENU}. */
  timeout?: number;
}

export async function awaitSelectMenuChoice(
  interaction: ChatInputCommandInteraction,
  response: Message | InteractionResponse,
  { userId, customId, timeout = TIMEOUTS.SELECT_MENU }: SelectMenuChoiceOptions,
): Promise<StringSelectMenuInteraction | null> {
  try {
    const picked = await response.awaitMessageComponent({
      filter: i => i.user.id === userId && i.customId === customId,
      time: timeout,
    });
    return picked.isStringSelectMenu() ? picked : null;
  } catch {
    // Timed out (or the interaction expired). Best-effort clear the menu.
    await interaction.editReply({ content: lang.errors.timeout, components: [] }).catch(() => null);
    return null;
  }
}

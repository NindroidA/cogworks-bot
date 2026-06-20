/**
 * Standardized ephemeral error replies.
 *
 * Collapses the repeated `interaction.reply({ content: `${E.error} ${msg}`,
 * flags: [MessageFlags.Ephemeral] })` boilerplate into one call that also picks
 * the right Discord method based on interaction state:
 *   - deferred  → editReply (no flags — the defer already set ephemeral)
 *   - replied   → followUp (ephemeral)
 *   - otherwise → reply (ephemeral)
 *
 * Pairs with {@link logHandlerError}: log the error, then surface it to the
 * user with `replyEphemeralError` — the caller no longer hand-distinguishes
 * reply vs editReply vs followUp.
 *
 * @example
 * // canonical: error-emoji prefix + lang string
 * await replyEphemeralError(interaction, tl.update.itemNotFound);
 * @example
 * // post-deferReply error in a catch block
 * logHandlerError('Memory add', error, { guildId });
 * await replyEphemeralError(interaction, tl.add.error);
 * @example
 * // bug-report link (unexpected failure)
 * await replyEphemeralError(interaction, 'Something went wrong.', { bugReport: true });
 * @example
 * // message that already carries its own formatting/emoji
 * await replyEphemeralError(interaction, result.error, { prefix: false });
 */

import { type MessageComponentInteraction, MessageFlags, type RepliableInteraction } from 'discord.js';
import { buildErrorMessage } from '../discord/verifiedDelete';
import { E } from '../emojis';

/**
 * Any interaction that can be replied to. Includes the abstract
 * `MessageComponentInteraction` base (used as a handler param type in some
 * collector flows) alongside the concrete `RepliableInteraction` union.
 */
export type EphemeralErrorTarget = RepliableInteraction | MessageComponentInteraction;

export interface EphemeralErrorOptions {
  /** Prepend the standard error emoji (`${E.error} `). Default true. */
  prefix?: boolean;
  /** Wrap the message via {@link buildErrorMessage} (appends a bug-report link). Default false. */
  bugReport?: boolean;
}

/**
 * Reply to an interaction with an ephemeral error message, choosing reply /
 * editReply / followUp based on the interaction's current state. Never throws
 * on a secondary Discord failure (e.g. expired interaction) — it best-effort
 * surfaces the message and swallows delivery errors so callers in catch blocks
 * don't cascade.
 */
export async function replyEphemeralError(
  interaction: EphemeralErrorTarget,
  message: string,
  options: EphemeralErrorOptions = {},
): Promise<void> {
  const { prefix = true, bugReport = false } = options;
  let body = bugReport ? buildErrorMessage(message) : message;
  if (prefix) body = `${E.error} ${body}`;

  try {
    if (interaction.deferred) {
      // Already deferred ephemerally — editReply rejects the flags option.
      await interaction.editReply({ content: body });
    } else if (interaction.replied) {
      await (interaction as MessageComponentInteraction).followUp({
        content: body,
        flags: [MessageFlags.Ephemeral],
      });
    } else {
      await interaction.reply({ content: body, flags: [MessageFlags.Ephemeral] });
    }
  } catch {
    // Interaction expired / already acknowledged elsewhere — nothing more to do.
  }
}

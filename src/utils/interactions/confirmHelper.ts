/**
 * Confirmation Button Helper
 *
 * Standardizes the confirm/cancel button pattern used throughout the bot.
 * Creates buttons, sends/updates the message, awaits response, and handles
 * cancel + timeout automatically. Returns the confirmed button interaction
 * or null if cancelled/timed out.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type EmbedBuilder,
  type InteractionResponse,
  type Message,
  type MessageComponentInteraction,
  MessageFlags,
} from 'discord.js';
import { lang } from '../../lang';
import { TIMEOUTS } from '../constants';

export interface ConfirmationOptions {
  /** The message to display above the buttons */
  message: string;
  /** Label for the confirm button (default: "Confirm") */
  confirmLabel?: string;
  /** Label for the cancel button (default: "Cancel") */
  cancelLabel?: string;
  /** Style for the confirm button (default: Danger) */
  confirmStyle?: ButtonStyle;
  /** Timeout in ms (default: TIMEOUTS.CONFIRMATION = 30s) */
  timeout?: number;
  /** Embed(s) to include with the message */
  embeds?: EmbedBuilder[];
  /** Custom ID prefix to avoid collisions (default: 'confirm') */
  idPrefix?: string;
}

export interface ConfirmationResult {
  /** The button interaction — already acknowledged via update() */
  interaction: ButtonInteraction;
  /** The response message (for further editReply calls) */
  response: InteractionResponse | Message;
}

/**
 * Show confirm/cancel buttons and await the user's response.
 * Automatically handles cancel (updates message to "Cancelled") and timeout
 * (removes components). Returns the confirmed ButtonInteraction or null.
 *
 * The interaction is replied to with the confirmation message.
 * Only use with interactions that haven't been replied to or deferred yet.
 *
 * @example
 * const result = await awaitConfirmation(interaction, {
 *   message: 'Delete this template?',
 *   confirmLabel: 'Delete',
 *   confirmStyle: ButtonStyle.Danger,
 * });
 * if (!result) return;
 * // result.interaction is already acknowledged — do your work, then:
 * await result.interaction.editReply({ content: 'Deleted!' });
 */
export async function awaitConfirmation(
  interaction: ChatInputCommandInteraction | MessageComponentInteraction,
  options: ConfirmationOptions,
): Promise<ConfirmationResult | null> {
  const prefix = options.idPrefix ?? 'confirm';
  const timeout = options.timeout ?? TIMEOUTS.CONFIRMATION;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${prefix}_yes`)
      .setLabel(options.confirmLabel ?? lang.general.buttons.confirm)
      .setStyle(options.confirmStyle ?? ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${prefix}_no`)
      .setLabel(options.cancelLabel ?? lang.general.buttons.cancel)
      .setStyle(ButtonStyle.Secondary),
  );

  const response = await interaction.reply({
    content: options.message,
    embeds: options.embeds ?? [],
    components: [row],
    flags: [MessageFlags.Ephemeral],
  });

  try {
    const btn = await response.awaitMessageComponent({
      filter: i => i.user.id === interaction.user.id && i.customId.startsWith(`${prefix}_`),
      time: timeout,
    });

    if (btn.customId === `${prefix}_no`) {
      await btn.update({
        content: lang.errors.cancelled,
        embeds: [],
        components: [],
      });
      return null;
    }

    // Acknowledge the confirm button with a loading state
    await btn.update({
      content: options.message,
      embeds: options.embeds ?? [],
      components: [],
    });
    return { interaction: btn as ButtonInteraction, response };
  } catch {
    // Timeout — silently remove buttons
    try {
      await interaction.editReply({ components: [] });
    } catch {
      /* expired */
    }
    return null;
  }
}

import {
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  ComponentType,
  type ContextMenuCommandInteraction,
  type InteractionResponse,
  type Message,
  type MessageComponentInteraction,
  MessageFlags,
} from 'discord.js';
import { lang } from '../lang';
import { enhancedLogger, LogCategory } from './monitoring/enhancedLogger';

export interface CollectorOptions {
  /** Timeout in milliseconds (default: 60000 = 1 minute) */
  timeout?: number;
  /** User ID that should be able to interact */
  userId: string;
}

export type ButtonCollectorCallback = (interaction: ButtonInteraction) => Promise<void> | void;

/**
 * Creates a button collector with standard configuration
 *
 * Supports two modes:
 * - Simple mode: Just message and timeout
 * - Full mode: With options, callbacks, and user filtering
 *
 * @param message - The message to collect interactions from
 * @param optionsOrTimeout - Either collector options object or timeout in ms
 * @param onCollect - Optional callback when button is clicked
 * @param onTimeout - Optional callback when collector times out
 * @returns The collector for further customization if needed
 * @example
 * // Simple mode
 * createButtonCollector(message, 60000);
 *
 * // Full mode with callbacks
 * createButtonCollector(
 *   message,
 *   { userId: '123456', timeout: 30000 },
 *   async (interaction) => {
 *     await interaction.reply('Clicked!');
 *   },
 *   async () => {
 *     await message.edit('Timed out');
 *   }
 * );
 */
export function createButtonCollector(
  message: Message | InteractionResponse,
  optionsOrTimeout: CollectorOptions | number,
  onCollect?: ButtonCollectorCallback,
  onTimeout?: () => Promise<void> | void,
) {
  // Determine if using simple mode (just timeout) or full mode (with options)
  const isSimpleMode = typeof optionsOrTimeout === 'number';
  const timeout = isSimpleMode ? optionsOrTimeout : optionsOrTimeout.timeout || 60_000;
  const userId = isSimpleMode ? undefined : optionsOrTimeout.userId;

  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: timeout,
    filter: userId ? i => i.user.id === userId : undefined,
  });

  if (onCollect) {
    collector.on('collect', async i => {
      try {
        await onCollect(i);
      } catch (error) {
        enhancedLogger.error('Collector onCollect callback failed', error as Error, LogCategory.ERROR);
      }
    });
  }

  if (onTimeout) {
    collector.on('end', async (_collected, reason) => {
      if (reason === 'time') {
        try {
          await onTimeout();
        } catch (error) {
          enhancedLogger.error('Collector onTimeout callback failed', error as Error, LogCategory.ERROR);
        }
      }
    });
  }

  return collector;
}

/**
 * Notify the user that a modal/form timed out.
 * Safe to call on any interaction state (replied, deferred, or fresh).
 * Use in awaitModalSubmit catch blocks to replace silent failures.
 */
export async function notifyModalTimeout(
  interaction:
    | ChatInputCommandInteraction
    | ButtonInteraction
    | MessageComponentInteraction
    | ContextMenuCommandInteraction,
): Promise<void> {
  try {
    const message = lang.errors.timeout;
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: message,
        flags: [MessageFlags.Ephemeral],
      });
    } else {
      await interaction.reply({
        content: message,
        flags: [MessageFlags.Ephemeral],
      });
    }
  } catch {
    // Interaction may have expired — silently ignore
  }
}

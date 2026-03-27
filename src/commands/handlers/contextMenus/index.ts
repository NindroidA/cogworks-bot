/**
 * Context Menu Command Router
 *
 * Routes context menu interactions to their respective handlers.
 */

import {
  type Client,
  type MessageContextMenuCommandInteraction,
  MessageFlags,
  type UserContextMenuCommandInteraction,
} from 'discord.js';
import { enhancedLogger, LogCategory } from '../../../utils';
import { captureToMemoryHandler } from './captureToMemory';
import { manageRestrictionsHandler } from './manageRestrictions';
import { openTicketForUserHandler } from './openTicketForUser';
import { viewBaitScoreHandler } from './viewBaitScore';

/** Message context menu command handlers */
const MESSAGE_CONTEXT_HANDLERS: Record<string, (interaction: MessageContextMenuCommandInteraction) => Promise<void>> = {
  'Capture to Memory': captureToMemoryHandler,
};

/** User context menu command handlers that need the client */
const USER_CONTEXT_CLIENT_HANDLERS: Record<
  string,
  (client: Client, interaction: UserContextMenuCommandInteraction) => Promise<void>
> = {
  'View Bait Score': viewBaitScoreHandler,
};

/** User context menu command handlers that don't need the client */
const USER_CONTEXT_HANDLERS: Record<string, (interaction: UserContextMenuCommandInteraction) => Promise<void>> = {
  'Open Ticket For User': openTicketForUserHandler,
  'Manage Restrictions': manageRestrictionsHandler,
};

/**
 * Route a context menu interaction to its handler.
 */
export async function handleContextMenuCommand(
  client: Client,
  interaction: MessageContextMenuCommandInteraction | UserContextMenuCommandInteraction,
): Promise<void> {
  const commandName = interaction.commandName;

  try {
    if (interaction.isMessageContextMenuCommand()) {
      const handler = MESSAGE_CONTEXT_HANDLERS[commandName];
      if (handler) {
        await handler(interaction);
        return;
      }
    }

    if (interaction.isUserContextMenuCommand()) {
      const clientHandler = USER_CONTEXT_CLIENT_HANDLERS[commandName];
      if (clientHandler) {
        await clientHandler(client, interaction);
        return;
      }

      const handler = USER_CONTEXT_HANDLERS[commandName];
      if (handler) {
        await handler(interaction);
        return;
      }
    }

    await interaction.reply({ content: 'Unknown context menu command.', flags: [MessageFlags.Ephemeral] });
  } catch (error) {
    enhancedLogger.error(`Context menu command failed: ${commandName}`, error as Error, LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      guildId: interaction.guildId,
    });

    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'An error occurred. Please try again.', flags: [MessageFlags.Ephemeral] });
      }
    } catch {
      // Interaction may have expired
    }
  }
}

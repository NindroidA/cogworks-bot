/**
 * "Capture to Memory" — Message Context Menu Command
 *
 * Right-click a message → Capture to Memory → Shows message info and directs
 * user to use /memory capture with the message link for the full flow.
 */

import { EmbedBuilder, type MessageContextMenuCommandInteraction, MessageFlags } from 'discord.js';
import {
  enhancedLogger,
  escapeDiscordMarkdown,
  handleInteractionError,
  LogCategory,
  requireAdmin,
} from '../../../utils';
import { Colors } from '../../../utils/colors';

export async function captureToMemoryHandler(interaction: MessageContextMenuCommandInteraction): Promise<void> {
  try {
    // Admin check — cast to any to satisfy requireAdmin which expects ChatInputCommandInteraction
    const adminCheck = requireAdmin(interaction as any);
    if (!adminCheck.allowed) {
      await interaction.reply({
        content: adminCheck.message,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const targetMessage = interaction.targetMessage;
    const author = escapeDiscordMarkdown(targetMessage.author?.displayName ?? 'Unknown');
    const content = targetMessage.content?.substring(0, 200) || '(no text content)';
    const messageLink = `https://discord.com/channels/${interaction.guildId}/${targetMessage.channelId}/${targetMessage.id}`;

    const embed = new EmbedBuilder()
      .setColor(Colors.status.info)
      .setTitle('Capture to Memory')
      .setDescription(
        `**Message by ${author}:**\n> ${content}${targetMessage.content && targetMessage.content.length > 200 ? '...' : ''}\n\n` +
          `Use the command below to capture this message:\n\`/memory capture message:${messageLink}\``,
      )
      .setFooter({ text: `Message ID: ${targetMessage.id}` });

    await interaction.reply({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral],
    });

    enhancedLogger.info('Capture to Memory context menu used', LogCategory.COMMAND_EXECUTION, {
      guildId: interaction.guildId,
      userId: interaction.user.id,
      targetMessageId: targetMessage.id,
    });
  } catch (error) {
    await handleInteractionError(interaction as any, error, 'Capture to Memory context menu');
  }
}

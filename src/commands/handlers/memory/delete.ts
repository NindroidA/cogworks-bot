import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type ChatInputCommandInteraction,
  MessageFlags,
  type ThreadChannel,
} from 'discord.js';
import { MemoryItem } from '../../../typeorm/entities/memory';
import {
  buildErrorMessage,
  E,
  enhancedLogger,
  guardAdminRateLimit,
  LogCategory,
  lang,
  RateLimits,
  verifiedThreadDelete,
} from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { resolveConfigFromThread } from './channelPicker';

const tl = lang.memory;
const memoryItemRepo = lazyRepo(MemoryItem);

/** Validate the interaction context: must be in a memory forum thread (not the welcome thread). */
async function validateDeleteContext(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId!;
  const channel = interaction.channel;

  if (!channel || channel.type !== ChannelType.PublicThread) {
    await interaction.reply({
      content: `${E.error} ${tl.delete.notAThread}`,
      flags: [MessageFlags.Ephemeral],
    });
    return null;
  }

  const threadChannel = channel as ThreadChannel;

  const config = await resolveConfigFromThread(guildId, threadChannel.parentId);
  if (!config) {
    await interaction.reply({
      content: `${E.error} ${tl.delete.notInForum}`,
      flags: [MessageFlags.Ephemeral],
    });
    return null;
  }

  if (config.messageId && threadChannel.id === config.messageId) {
    await interaction.reply({
      content: `${E.error} ${tl.delete.cannotDeleteWelcome}`,
      flags: [MessageFlags.Ephemeral],
    });
    return null;
  }

  return threadChannel;
}

/** Build the confirmation button row for delete. */
function buildDeleteConfirmationRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('memory_delete_confirm')
      .setLabel(lang.general.buttons.delete)
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('memory_delete_cancel')
      .setLabel(lang.general.buttons.cancel)
      .setStyle(ButtonStyle.Secondary),
  );
}

/** Execute the deletion: Discord thread first, then DB record. */
async function executeMemoryDeletion(
  threadChannel: ThreadChannel,
  memoryItem: MemoryItem | null,
  guildId: string,
): Promise<{ success: boolean; errorMessage?: string }> {
  const deleteResult = await verifiedThreadDelete(threadChannel, {
    guildId,
    label: 'memory thread',
  });

  if (!deleteResult.success) {
    return {
      success: false,
      errorMessage: buildErrorMessage(
        `${E.error} Failed to delete the memory thread from Discord. The database entry was not removed.`,
      ),
    };
  }

  if (memoryItem) {
    await memoryItemRepo.remove(memoryItem);
  }

  return { success: true };
}

export const memoryDeleteHandler = async (interaction: ChatInputCommandInteraction) => {
  const guard = await guardAdminRateLimit(interaction, {
    action: 'memory-delete',
    limit: RateLimits.MEMORY_OPERATION,
    scope: 'userGuild',
  });
  if (!guard.allowed) return;

  const guildId = interaction.guildId!;

  // Validate context: must be in a memory forum thread
  const threadChannel = await validateDeleteContext(interaction);
  if (!threadChannel) return;

  // Get the memory item from database (optional - thread might exist without DB entry)
  const memoryItem = await memoryItemRepo.findOneBy({
    guildId,
    threadId: threadChannel.id,
  });

  // Show confirmation
  const response = await interaction.reply({
    content: `${E.warning} ${tl.delete.confirmMessage}\n\n**Thread:** ${threadChannel.name}`,
    components: [buildDeleteConfirmationRow()],
    flags: [MessageFlags.Ephemeral],
  });

  const collector = response.createMessageComponentCollector({
    time: 60000,
  });

  collector.on('collect', async i => {
    if (i.user.id !== interaction.user.id) {
      await i.reply({
        content: lang.errors.notYourInteraction,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    if (i.customId === 'memory_delete_cancel') {
      collector.stop('cancelled');
      await i.update({
        content: lang.errors.cancelled,
        components: [],
      });
      return;
    }

    if (i.customId === 'memory_delete_confirm') {
      collector.stop('confirmed');

      try {
        const result = await executeMemoryDeletion(threadChannel, memoryItem, guildId);
        if (!result.success) {
          await i.update({ content: result.errorMessage!, components: [] });
          return;
        }

        await i.update({
          content: `${E.success} ${tl.delete.success}`,
          components: [],
        });
      } catch (error) {
        enhancedLogger.error(
          `Memory delete error: ${error}`,
          error instanceof Error ? error : undefined,
          LogCategory.COMMAND_EXECUTION,
          { guildId },
        );
        await i
          .update({
            content: buildErrorMessage(`${E.error} ${tl.delete.error}`),
            components: [],
          })
          .catch(() => null);
      }
      return;
    }
  });

  collector.on('end', (_, reason) => {
    if (reason === 'time') {
      interaction
        .editReply({
          content: lang.errors.timeout,
          components: [],
        })
        .catch(() => null);
    }
  });
};

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
  createRateLimitKey,
  E,
  enhancedLogger,
  healthMonitor,
  LogCategory,
  lang,
  RateLimits,
  rateLimiter,
  requireAdmin,
} from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { resolveConfigFromThread } from './channelPicker';

const tl = lang.memory;
const memoryItemRepo = lazyRepo(MemoryItem);

export const memoryDeleteHandler = async (interaction: ChatInputCommandInteraction) => {
  const startTime = Date.now();
  const adminCheck = requireAdmin(interaction);
  if (!adminCheck.allowed) {
    await interaction.reply({
      content: adminCheck.message,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const guildId = interaction.guildId!;
  const userId = interaction.user.id;

  // Rate limit check
  const rateLimitKey = createRateLimitKey.userGuild(userId, guildId, 'memory-delete');
  const rateCheck = rateLimiter.check(rateLimitKey, RateLimits.MEMORY_OPERATION);
  if (!rateCheck.allowed) {
    await interaction.reply({
      content: rateCheck.message!,
      flags: [MessageFlags.Ephemeral],
    });
    healthMonitor.recordCommand('memory delete', Date.now() - startTime, true);
    return;
  }

  const channel = interaction.channel;

  // Check if we're in a thread within the memory forum
  if (!channel || channel.type !== ChannelType.PublicThread) {
    await interaction.reply({
      content: `${E.error} ${tl.delete.notAThread}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const threadChannel = channel as ThreadChannel;

  const config = await resolveConfigFromThread(guildId, threadChannel.parentId);
  if (!config) {
    await interaction.reply({
      content: `${E.error} ${tl.delete.notInForum}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Check if this is the welcome thread (cannot delete)
  if (config.messageId && threadChannel.id === config.messageId) {
    await interaction.reply({
      content: `${E.error} ${tl.delete.cannotDeleteWelcome}`,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Get the memory item from database (optional - thread might exist without DB entry)
  const memoryItem = await memoryItemRepo.findOneBy({
    guildId,
    threadId: threadChannel.id,
  });

  // Show confirmation
  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('memory_delete_confirm')
      .setLabel(lang.general.buttons.delete)
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('memory_delete_cancel')
      .setLabel(lang.general.buttons.cancel)
      .setStyle(ButtonStyle.Secondary),
  );

  const response = await interaction.reply({
    content: `${E.warning} ${tl.delete.confirmMessage}\n\n**Thread:** ${threadChannel.name}`,
    components: [buttonRow],
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
        if (memoryItem) {
          await memoryItemRepo.remove(memoryItem);
        }

        await i.update({
          content: `${E.success} ${tl.delete.success}`,
          components: [],
        });

        await threadChannel.delete();
      } catch (error) {
        enhancedLogger.error(
          `Memory delete error: ${error}`,
          error instanceof Error ? error : undefined,
          LogCategory.COMMAND_EXECUTION,
          { guildId },
        );
        await i
          .update({
            content: `${E.error} ${tl.delete.error}`,
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

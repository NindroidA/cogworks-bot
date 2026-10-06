import {
  ActionRowBuilder,
  type BaseMessageOptions,
  type ChatInputCommandInteraction,
  type InteractionResponse,
  MessageFlags,
  StringSelectMenuBuilder,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { MemoryConfig } from '../../../typeorm/entities/memory';
import { awaitSelectMenuChoice, E, lang, replyEphemeralError } from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';

const tl = lang.memory;
const memoryConfigRepo = lazyRepo(MemoryConfig);

/** The interaction that owns a memory flow's next response. */
export type MemoryFlowInteraction = ChatInputCommandInteraction | StringSelectMenuInteraction;

export interface ResolvedMemoryConfig {
  config: MemoryConfig;
  /**
   * Respond from this, never from the slash command. With one memory forum it
   * is the slash command itself. With 2+ it is the channel picker's select,
   * left unacknowledged so the caller can open a modal from it or replace the
   * picker message (the slash command has already replied with the picker, and
   * replying twice throws InteractionAlreadyReplied).
   */
  source: MemoryFlowInteraction;
}

export async function resolveMemoryConfig(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<ResolvedMemoryConfig | null> {
  const configs = await memoryConfigRepo.find({
    where: { guildId },
    order: { sortOrder: 'ASC' },
  });

  if (configs.length === 0) {
    await replyEphemeralError(interaction, tl.errors.notConfigured);
    return null;
  }

  if (configs.length === 1) {
    return { config: configs[0], source: interaction };
  }

  const selectMenu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('memory_channel_picker')
      .setPlaceholder(tl.channelPicker.placeholder)
      .addOptions(
        configs.map(c => ({
          label: c.channelName,
          value: c.id.toString(),
          description: `${lang.memory.channelPicker.forumPrefix} <#${c.forumChannelId}>`,
        })),
      ),
  );

  const response = await interaction.reply({
    content: `${E.memory} **${tl.channelPicker.title}**\n${tl.channelPicker.description}`,
    components: [selectMenu],
    flags: [MessageFlags.Ephemeral],
  });

  const choice = await awaitSelectMenuChoice(interaction, response, {
    userId: interaction.user.id,
    customId: 'memory_channel_picker',
  });
  if (!choice) return null;

  const selectedId = Number.parseInt(choice.values[0], 10);
  const config = configs.find(c => c.id === selectedId);
  if (!config) {
    await replyFlowError(choice, tl.errors.notConfigured);
    return null;
  }
  return { config, source: choice };
}

type FlowMessage = Pick<BaseMessageOptions, 'content' | 'embeds' | 'components'>;

/**
 * Send a memory flow's next ephemeral screen: a fresh slash command replies,
 * the picker's select replaces the picker message in place. Either response
 * supports `createMessageComponentCollector`, and `source.editReply` edits it.
 */
export function replyFlow(source: MemoryFlowInteraction, message: FlowMessage): Promise<InteractionResponse> {
  if (source.isChatInputCommand()) {
    return source.reply({ ...message, flags: [MessageFlags.Ephemeral] });
  }
  return source.update({
    content: message.content ?? '',
    embeds: message.embeds ?? [],
    components: message.components ?? [],
  });
}

/**
 * Error counterpart of {@link replyFlow}: on an unanswered picker select the
 * error replaces the picker (otherwise its menu stays up, dead); everything
 * else goes through `replyEphemeralError`.
 */
export async function replyFlowError(source: MemoryFlowInteraction, message: string): Promise<void> {
  if (source.isStringSelectMenu() && !source.replied && !source.deferred) {
    try {
      await source.update({ content: `${E.error} ${message}`, embeds: [], components: [] });
      return;
    } catch {
      // Fall through: replyEphemeralError picks the right method and never throws.
    }
  }
  await replyEphemeralError(source, message);
}

export async function resolveConfigFromThread(
  guildId: string,
  parentChannelId: string | null,
): Promise<MemoryConfig | null> {
  if (!parentChannelId) return null;
  return memoryConfigRepo.findOneBy({ guildId, forumChannelId: parentChannelId });
}

import { ActionRowBuilder, type ChatInputCommandInteraction, MessageFlags, StringSelectMenuBuilder } from 'discord.js';
import { MemoryConfig } from '../../../typeorm/entities/memory';
import { awaitSelectMenuChoice, E, lang, replyEphemeralError } from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';

const tl = lang.memory;
const memoryConfigRepo = lazyRepo(MemoryConfig);

export async function resolveMemoryConfig(
  interaction: ChatInputCommandInteraction,
  guildId: string,
): Promise<MemoryConfig | null> {
  const configs = await memoryConfigRepo.find({
    where: { guildId },
    order: { sortOrder: 'ASC' },
  });

  if (configs.length === 0) {
    await replyEphemeralError(interaction, tl.errors.notConfigured);
    return null;
  }

  if (configs.length === 1) {
    return configs[0];
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
  await choice.update({ content: `${E.loading} ${lang.memory.channelPicker.processing}`, components: [] });
  return config || null;
}

export async function resolveConfigFromThread(
  guildId: string,
  parentChannelId: string | null,
): Promise<MemoryConfig | null> {
  if (!parentChannelId) return null;
  return memoryConfigRepo.findOneBy({ guildId, forumChannelId: parentChannelId });
}

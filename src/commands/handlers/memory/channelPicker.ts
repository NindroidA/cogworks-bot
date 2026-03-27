import { ActionRowBuilder, type ChatInputCommandInteraction, MessageFlags, StringSelectMenuBuilder } from 'discord.js';
import { MemoryConfig } from '../../../typeorm/entities/memory';
import { E, lang } from '../../../utils';
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
    await interaction.reply({
      content: `${E.error} ${tl.errors.notConfigured}`,
      flags: [MessageFlags.Ephemeral],
    });
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
          description: `Forum: <#${c.forumChannelId}>`,
        })),
      ),
  );

  const response = await interaction.reply({
    content: `${E.memory} **${tl.channelPicker.title}**\n${tl.channelPicker.description}`,
    components: [selectMenu],
    flags: [MessageFlags.Ephemeral],
  });

  try {
    const i = await response.awaitMessageComponent({
      filter: i => i.user.id === interaction.user.id && i.customId === 'memory_channel_picker',
      time: 30000,
    });

    if (i.isStringSelectMenu()) {
      const selectedId = Number.parseInt(i.values[0], 10);
      const config = configs.find(c => c.id === selectedId);

      await i.update({ content: `${E.loading} Processing...`, components: [] });

      return config || null;
    }
  } catch {
    await interaction.editReply({
      content: lang.errors.timeout,
      components: [],
    });
  }

  return null;
}

export async function resolveConfigFromThread(
  guildId: string,
  parentChannelId: string | null,
): Promise<MemoryConfig | null> {
  if (!parentChannelId) return null;
  return memoryConfigRepo.findOneBy({ guildId, forumChannelId: parentChannelId });
}

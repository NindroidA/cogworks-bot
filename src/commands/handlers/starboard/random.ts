import type { CacheType, ChatInputCommandInteraction } from 'discord.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { StarboardEntry } from '../../../typeorm/entities/starboard';
import { handleInteractionError, lang } from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';

const entryRepo = lazyRepo(StarboardEntry);
const tl = lang.starboard;

/**
 * Handle /starboard random
 */
export const starboardRandomHandler = async (
  interaction: ChatInputCommandInteraction<CacheType>,
): Promise<void> => {
  try {
    const guildId = interaction.guildId!;
    const count = await entryRepo.count({ where: { guildId } });

    if (count === 0) {
      await interaction.reply({
        content: tl.random.noEntries,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Pick a random entry
    const randomOffset = Math.floor(Math.random() * count);
    const entries = await entryRepo.find({
      where: { guildId },
      skip: randomOffset,
      take: 1,
    });

    const entry = entries[0];
    if (!entry) {
      await interaction.reply({
        content: tl.random.noEntries,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const messageLink = `https://discord.com/channels/${guildId}/${entry.originalChannelId}/${entry.originalMessageId}`;

    const embed = new EmbedBuilder()
      .setTitle(tl.random.title)
      .setDescription(entry.content || '*(no text content)*')
      .setColor(0xffac33)
      .setFooter({
        text: `\u2B50 ${entry.starCount} | #${entry.originalChannelId}`,
      })
      .setTimestamp(entry.createdAt);

    if (entry.attachmentUrl) {
      embed.setImage(entry.attachmentUrl);
    }

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('Jump to Original')
        .setStyle(ButtonStyle.Link)
        .setURL(messageLink),
    );

    await interaction.reply({
      embeds: [embed],
      components: [row],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, 'Starboard random failed');
  }
};

import type { CacheType, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder, MessageFlags } from 'discord.js';
import { StarboardEntry } from '../../../typeorm/entities/starboard';
import { guardFeatureAccess, handleInteractionError, lang, replyEphemeralError } from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';

const entryRepo = lazyRepo(StarboardEntry);
const tl = lang.starboard;

/**
 * Handle /starboard stats
 */
export async function starboardStatsHandler(interaction: ChatInputCommandInteraction<CacheType>): Promise<void> {
  try {
    // 'use' keeps it admin-only in guilds without dashboard grants, as it was
    // under the old Administrator default.
    const guard = await guardFeatureAccess(interaction, 'starboard', 'use');
    if (!guard.allowed) return;

    const guildId = interaction.guildId!;
    const entries = await entryRepo.find({
      where: { guildId },
      order: { starCount: 'DESC' },
    });

    if (entries.length === 0) {
      await replyEphemeralError(interaction, tl.stats.noEntries);
      return;
    }

    const totalStarred = entries.length;
    const topEntry = entries[0];
    const topMessageLink = `https://discord.com/channels/${guildId}/${topEntry.originalChannelId}/${topEntry.originalMessageId}`;

    const embed = new EmbedBuilder()
      .setTitle(tl.stats.title)
      .setColor(0xffac33)
      .addFields(
        {
          name: tl.stats.totalStarred,
          value: totalStarred.toString(),
          inline: true,
        },
        {
          name: tl.stats.topMessage,
          value: `[${topEntry.starCount} stars](${topMessageLink})`,
          inline: true,
        },
      );

    await interaction.reply({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, 'Starboard stats failed');
  }
}

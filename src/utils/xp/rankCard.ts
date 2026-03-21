/**
 * Rank Card Embed Builder
 *
 * Creates a Discord embed showing a user's XP rank information.
 */

import { type ColorResolvable, EmbedBuilder, type User } from 'discord.js';
import type { XPUser } from '../../typeorm/entities/xp/XPUser';
import { buildProgressBar, xpProgress } from './xpCalculator';

/** Gold color for rank embeds */
const RANK_COLOR = '#FFD700' as ColorResolvable;

/**
 * Build a rank embed for a user showing their XP stats.
 *
 * @param user - The Discord user
 * @param xpUser - The XPUser entity with stats
 * @param rank - The user's rank position (1-based)
 * @param totalUsers - Total users with XP in the guild
 * @param nextRewardLevel - Optional: next role reward level threshold
 * @returns EmbedBuilder ready to send
 */
export function buildRankEmbed(
  user: User,
  xpUser: XPUser,
  rank: number,
  totalUsers: number,
  nextRewardLevel?: number,
): EmbedBuilder {
  const progress = xpProgress(xpUser.xp, xpUser.level);
  const progressBar = buildProgressBar(progress.percentage);

  const embed = new EmbedBuilder()
    .setColor(RANK_COLOR)
    .setAuthor({
      name: user.displayName,
      iconURL: user.displayAvatarURL({ size: 128 }),
    })
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .addFields(
      {
        name: 'Rank',
        value: `#${rank} / ${totalUsers}`,
        inline: true,
      },
      {
        name: 'Level',
        value: `${xpUser.level}`,
        inline: true,
      },
      {
        name: 'Total XP',
        value: `${xpUser.xp.toLocaleString()}`,
        inline: true,
      },
      {
        name: 'Progress',
        value: `${progressBar}\n${progress.current.toLocaleString()} / ${progress.needed.toLocaleString()} XP`,
        inline: false,
      },
      {
        name: 'Stats',
        value: `Messages: **${xpUser.messages.toLocaleString()}** | Voice: **${xpUser.voiceMinutes.toLocaleString()}** min`,
        inline: false,
      },
    )
    .setTimestamp();

  if (nextRewardLevel !== undefined) {
    embed.setFooter({ text: `Next role reward at Level ${nextRewardLevel}` });
  }

  return embed;
}

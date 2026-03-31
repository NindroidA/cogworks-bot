import type { ColorResolvable } from 'discord.js';
import { type ChatInputCommandInteraction, type Client, EmbedBuilder, MessageFlags } from 'discord.js';
import xpLang from '../../../lang/xp.json';
import { XPUser } from '../../../typeorm/entities/xp/XPUser';
import { handleInteractionError } from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { getXPConfig } from './setup';

const LEADERBOARD_COLOR = '#FFD700' as ColorResolvable;
const PAGE_SIZE = 10;

const userRepo = lazyRepo(XPUser);

export async function leaderboardHandler(_client: Client, interaction: ChatInputCommandInteraction) {
  try {
    const guildId = interaction.guildId;
    if (!guildId) return;

    const config = await getXPConfig(guildId);
    if (!config?.enabled) {
      await interaction.reply({
        content: xpLang.errors.notConfigured,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const page = Math.max(1, interaction.options.getInteger('page') || 1);
    const _offset = (page - 1) * PAGE_SIZE;

    const totalUsers = await userRepo.count({ where: { guildId } });
    if (totalUsers === 0) {
      await interaction.reply({
        content: xpLang.leaderboard.empty,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const totalPages = Math.ceil(totalUsers / PAGE_SIZE);
    const safePage = Math.min(page, totalPages);
    const safeOffset = (safePage - 1) * PAGE_SIZE;

    const users = await userRepo.find({
      where: { guildId },
      order: { xp: 'DESC' },
      skip: safeOffset,
      take: PAGE_SIZE,
    });

    const entries = users.map((u, i) =>
      xpLang.leaderboard.entry
        .replace('{0}', String(safeOffset + i + 1))
        .replace('{1}', u.userId)
        .replace('{2}', String(u.level))
        .replace('{3}', u.xp.toLocaleString()),
    );

    const embed = new EmbedBuilder()
      .setColor(LEADERBOARD_COLOR)
      .setTitle(xpLang.leaderboard.title)
      .setDescription(entries.join('\n'))
      .setFooter({
        text: xpLang.leaderboard.footer.replace('{0}', String(safePage)).replace('{1}', String(totalPages)),
      });

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    await handleInteractionError(interaction, error, 'Failed to fetch leaderboard');
  }
}

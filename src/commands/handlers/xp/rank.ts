import { type ChatInputCommandInteraction, type Client, MessageFlags } from 'discord.js';
// Import lang directly to avoid needing lang/index.ts changes
import xpLang from '../../../lang/xp.json';
import { XPRoleReward } from '../../../typeorm/entities/xp/XPRoleReward';
import { XPUser } from '../../../typeorm/entities/xp/XPUser';
import { handleInteractionError } from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { buildRankEmbed } from '../../../utils/xp/rankCard';
import { getXPConfig } from './setup';

const userRepo = lazyRepo(XPUser);
const rewardRepo = lazyRepo(XPRoleReward);

export const rankHandler = async (_client: Client, interaction: ChatInputCommandInteraction) => {
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

    const targetUser = interaction.options.getUser('user') || interaction.user;

    const xpUser = await userRepo.findOne({
      where: { guildId, userId: targetUser.id },
    });

    if (!xpUser) {
      const msg =
        targetUser.id === interaction.user.id
          ? xpLang.rank.noData
          : xpLang.rank.noDataOther.replace('{0}', targetUser.displayName);
      await interaction.reply({
        content: msg,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Calculate rank (count users with more XP + 1)
    const rank = await userRepo
      .createQueryBuilder('xp')
      .where('xp.guildId = :guildId', { guildId })
      .andWhere('xp.xp > :userXp', { userXp: xpUser.xp })
      .getCount();

    const totalUsers = await userRepo.count({ where: { guildId } });

    // Find next role reward level above current level
    const nextReward = await rewardRepo
      .createQueryBuilder('reward')
      .where('reward.guildId = :guildId', { guildId })
      .andWhere('reward.level > :currentLevel', { currentLevel: xpUser.level })
      .orderBy('reward.level', 'ASC')
      .getOne();

    const embed = buildRankEmbed(targetUser, xpUser, rank + 1, totalUsers, nextReward?.level);

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    await handleInteractionError(interaction, error, 'Failed to fetch rank');
  }
};

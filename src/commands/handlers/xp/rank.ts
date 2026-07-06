import { type ChatInputCommandInteraction, type Client, MessageFlags } from 'discord.js';
// Import lang directly to avoid needing lang/index.ts changes
import { lang } from '../../../lang';
import { XPRoleReward } from '../../../typeorm/entities/xp/XPRoleReward';
import { XPUser } from '../../../typeorm/entities/xp/XPUser';
import { handleInteractionError, replyEphemeralError } from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { getXPConfig } from '../../../utils/xp/configCache';
import { buildRankEmbed } from '../../../utils/xp/rankCard';

// Locale-aware (Proxy fallback) — was a direct en JSON import that bypassed i18n.
const xpLang = lang.xp;

const userRepo = lazyRepo(XPUser);
const rewardRepo = lazyRepo(XPRoleReward);

export async function rankHandler(_client: Client, interaction: ChatInputCommandInteraction) {
  try {
    const guildId = interaction.guildId;
    if (!guildId) return;

    const config = await getXPConfig(guildId);
    if (!config?.enabled) {
      await replyEphemeralError(interaction, xpLang.errors.notConfigured);
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
}

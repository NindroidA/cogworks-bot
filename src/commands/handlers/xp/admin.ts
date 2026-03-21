import { type ChatInputCommandInteraction, type Client, MessageFlags } from 'discord.js';
import xpLang from '../../../lang/xp.json';
import { XPUser } from '../../../typeorm/entities/xp/XPUser';
import { enhancedLogger, handleInteractionError, LogCategory } from '../../../utils';
import { lazyRepo } from '../../../utils/database/lazyRepo';
import { calculateLevel } from '../../../utils/xp/xpCalculator';

const userRepo = lazyRepo(XPUser);

export const xpAdminHandler = async (_client: Client, interaction: ChatInputCommandInteraction) => {
  try {
    const guildId = interaction.guildId;
    if (!guildId) return;

    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'set':
        await handleSet(interaction, guildId);
        break;
      case 'reset':
        await handleReset(interaction, guildId);
        break;
      case 'reset-all':
        await handleResetAll(interaction, guildId);
        break;
      default:
        await interaction.reply({
          content: 'Unknown subcommand.',
          flags: [MessageFlags.Ephemeral],
        });
    }
  } catch (error) {
    await handleInteractionError(interaction, error, 'Failed to execute XP admin command');
  }
};

async function handleSet(interaction: ChatInputCommandInteraction, guildId: string) {
  const targetUser = interaction.options.getUser('user', true);
  const xpAmount = interaction.options.getInteger('xp', true);

  let xpUser = await userRepo.findOne({
    where: { guildId, userId: targetUser.id },
  });

  if (!xpUser) {
    xpUser = userRepo.create({
      guildId,
      userId: targetUser.id,
    });
  }

  xpUser.xp = xpAmount;
  xpUser.level = calculateLevel(xpAmount);
  await userRepo.save(xpUser);

  enhancedLogger.info(
    `Admin ${interaction.user.id} set XP for ${targetUser.id} to ${xpAmount} in guild ${guildId}`,
    LogCategory.COMMAND_EXECUTION,
  );

  await interaction.reply({
    content: xpLang.admin.xpSet
      .replace('{0}', targetUser.displayName)
      .replace('{1}', xpAmount.toLocaleString())
      .replace('{2}', String(xpUser.level)),
    flags: [MessageFlags.Ephemeral],
  });
}

async function handleReset(interaction: ChatInputCommandInteraction, guildId: string) {
  const targetUser = interaction.options.getUser('user', true);

  const xpUser = await userRepo.findOne({
    where: { guildId, userId: targetUser.id },
  });

  if (!xpUser) {
    await interaction.reply({
      content: xpLang.admin.noXpData.replace('{0}', targetUser.displayName),
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  xpUser.xp = 0;
  xpUser.level = 0;
  xpUser.messages = 0;
  xpUser.voiceMinutes = 0;
  xpUser.lastXpAt = null;
  xpUser.lastVoiceJoinedAt = null;
  await userRepo.save(xpUser);

  enhancedLogger.info(
    `Admin ${interaction.user.id} reset XP for ${targetUser.id} in guild ${guildId}`,
    LogCategory.COMMAND_EXECUTION,
  );

  await interaction.reply({
    content: xpLang.admin.xpReset.replace('{0}', targetUser.displayName),
    flags: [MessageFlags.Ephemeral],
  });
}

async function handleResetAll(interaction: ChatInputCommandInteraction, guildId: string) {
  // Send confirmation prompt
  await interaction.reply({
    content: xpLang.admin.xpResetAllConfirm,
    flags: [MessageFlags.Ephemeral],
  });

  const channel = interaction.channel;
  if (!channel || !('awaitMessages' in channel)) return;

  try {
    const collected = await channel.awaitMessages({
      filter: m => m.author.id === interaction.user.id,
      max: 1,
      time: 30_000,
    });

    const response = collected.first();
    if (!response || response.content !== 'CONFIRM') {
      await interaction.followUp({
        content: xpLang.admin.xpResetAllCancelled,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Delete the confirmation message if possible
    try {
      await response.delete();
    } catch {
      // May not have permission to delete — non-critical
    }

    await userRepo.delete({ guildId });

    enhancedLogger.info(
      `Admin ${interaction.user.id} reset ALL XP data for guild ${guildId}`,
      LogCategory.COMMAND_EXECUTION,
    );

    await interaction.followUp({
      content: xpLang.admin.xpResetAll,
      flags: [MessageFlags.Ephemeral],
    });
  } catch {
    await interaction.followUp({
      content: xpLang.admin.xpResetAllCancelled,
      flags: [MessageFlags.Ephemeral],
    });
  }
}

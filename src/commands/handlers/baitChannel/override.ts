import {
  type ChatInputCommandInteraction,
  type Client,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { BaitChannelLog } from '../../../typeorm/entities/BaitChannelLog';
import { handleInteractionError, lang, safeDbOperation } from '../../../utils';

const tl = lang.baitChannel;

export const overrideHandler = async (
  _client: Client,
  interaction: ChatInputCommandInteraction,
) => {
  try {
    const guildId = interaction.guildId!;
    const targetUser = interaction.options.getUser('user', true);

    const logRepo = AppDataSource.getRepository(BaitChannelLog);

    // Find the most recent log entry for this user in the guild
    const recentLog = await safeDbOperation(
      () =>
        logRepo.findOne({
          where: {
            guildId,
            userId: targetUser.id,
          },
          order: { createdAt: 'DESC' },
        }),
      'Find recent bait channel log',
    );

    if (!recentLog) {
      await interaction.reply({
        content: tl.override.noEntry,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    if (recentLog.overridden) {
      await interaction.reply({
        content: tl.override.alreadyOverridden,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    if (recentLog.actionTaken === 'logged') {
      await interaction.reply({
        content: tl.override.logOnlyCannotOverride,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Update the log entry with override info
    recentLog.overridden = true;
    recentLog.overriddenBy = interaction.user.id;
    recentLog.overriddenAt = new Date();

    await safeDbOperation(() => logRepo.save(recentLog), 'Save override to bait channel log');

    const embed = new EmbedBuilder()
      .setColor('#00FF00')
      .setTitle(tl.override.title)
      .setDescription(tl.override.success.replace('{0}', targetUser.tag))
      .addFields(
        { name: tl.override.user, value: `${targetUser.tag} (${targetUser.id})`, inline: true },
        { name: tl.override.action, value: recentLog.actionTaken, inline: true },
        { name: tl.override.score, value: `${recentLog.suspicionScore}/100`, inline: true },
        { name: tl.override.overriddenBy, value: `<@${interaction.user.id}>`, inline: true },
        {
          name: tl.override.detectedAt,
          value: `<t:${Math.floor(recentLog.createdAt.getTime() / 1000)}:R>`,
          inline: true,
        },
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
  } catch (error) {
    await handleInteractionError(interaction, error, tl.error.override);
  }
};

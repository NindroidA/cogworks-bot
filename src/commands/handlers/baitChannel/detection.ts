import {
  type ChatInputCommandInteraction,
  type Client,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { BaitChannelConfig } from '../../../typeorm/entities/BaitChannelConfig';
import { handleInteractionError, lang, safeDbOperation } from '../../../utils';
import type { BaitChannelManager } from '../../../utils/baitChannelManager';

const tl = lang.baitChannel;

export const detectionHandler = async (
  client: Client,
  interaction: ChatInputCommandInteraction,
) => {
  try {
    const enabled = interaction.options.getBoolean('enabled', true);
    const minAge = interaction.options.getInteger('min_account_age');
    const minMembership = interaction.options.getInteger('min_membership');
    const minMessages = interaction.options.getInteger('min_messages');
    const requireVerification = interaction.options.getBoolean('require_verification');
    const disableAdminWhitelist = interaction.options.getBoolean('disable_admin_whitelist');

    const configRepo = AppDataSource.getRepository(BaitChannelConfig);
    const config = await safeDbOperation(
      () => configRepo.findOne({ where: { guildId: interaction.guildId! } }),
      'Find bait channel config',
    );

    if (!config) {
      await interaction.reply({
        content: tl.setupFirst,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    config.enableSmartDetection = enabled;
    if (minAge !== null) config.minAccountAgeDays = minAge;
    if (minMembership !== null) config.minMembershipMinutes = minMembership;
    if (minMessages !== null) config.minMessageCount = minMessages;
    if (requireVerification !== null) config.requireVerification = requireVerification;
    if (disableAdminWhitelist !== null) config.disableAdminWhitelist = disableAdminWhitelist;

    await safeDbOperation(() => configRepo.save(config), 'Save bait channel config');

    const { baitChannelManager } = client as { baitChannelManager?: BaitChannelManager };
    if (baitChannelManager) {
      baitChannelManager.clearConfigCache(interaction.guildId!);
    }

    const embed = new EmbedBuilder()
      .setColor('#00FF00')
      .setTitle(tl.detection.title)
      .addFields(
        {
          name: tl.detection.enabled,
          value: enabled ? tl.detection.yes : tl.detection.no,
          inline: true,
        },
        {
          name: tl.detection.minAccountAge,
          value: tl.detection.days.replace('{0}', config.minAccountAgeDays.toString()),
          inline: true,
        },
        {
          name: tl.detection.minMembership,
          value: tl.detection.minutes.replace('{0}', config.minMembershipMinutes.toString()),
          inline: true,
        },
        { name: tl.detection.minMessages, value: `${config.minMessageCount}`, inline: true },
        {
          name: tl.detection.requireVerification,
          value: config.requireVerification ? tl.detection.yes : tl.detection.no,
          inline: true,
        },
      );

    await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
  } catch (error) {
    await handleInteractionError(interaction, error, tl.error.updateDetection);
  }
};

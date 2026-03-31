import { type ChatInputCommandInteraction, type Client, EmbedBuilder, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { BaitChannelConfig } from '../../../typeorm/entities/bait/BaitChannelConfig';
import { handleInteractionError, lang, safeDbOperation } from '../../../utils';

const tl = lang.baitChannel;

export async function statusHandler(_client: Client, interaction: ChatInputCommandInteraction) {
  try {
    const configRepo = AppDataSource.getRepository(BaitChannelConfig);
    const config = await safeDbOperation(
      () => configRepo.findOne({ where: { guildId: interaction.guildId! } }),
      'Find bait channel config',
    );

    if (!config) {
      await interaction.reply({
        content: tl.notConfigured,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Build channel list from channelIds or legacy channelId
    const baitChannelIds = config.channelIds?.length ? config.channelIds : config.channelId ? [config.channelId] : [];
    const channelMentions = baitChannelIds.map(id => `<#${id}>`).join(', ') || tl.status.channelNotFound;

    const logChannel = config.logChannelId
      ? await interaction.guild!.channels.fetch(config.logChannelId).catch(() => null)
      : null;

    const embed = new EmbedBuilder()
      .setColor(config.enabled ? '#00FF00' : '#FF0000')
      .setTitle(tl.status.title)
      .addFields(
        {
          name: 'Status',
          value: config.enabled ? tl.status.statusEnabled : tl.status.statusDisabled,
          inline: true,
        },
        {
          name: baitChannelIds.length > 1 ? 'Channels' : 'Channel',
          value: channelMentions,
          inline: true,
        },
        { name: 'Action Type', value: config.actionType, inline: true },
        {
          name: 'Grace Period',
          value: `${config.gracePeriodSeconds}s`,
          inline: true,
        },
        {
          name: 'Smart Detection',
          value: config.enableSmartDetection ? tl.status.smartOn : tl.status.smartOff,
          inline: true,
        },
        {
          name: 'Log Channel',
          value: logChannel ? `<#${logChannel.id}>` : tl.status.logNone,
          inline: true,
        },
      );

    if (config.enableSmartDetection) {
      embed.addFields({
        name: tl.status.detectionSettings,
        value: [
          tl.status.minAccountAge.replace('{0}', config.minAccountAgeDays.toString()),
          tl.status.minMembership.replace('{0}', config.minMembershipMinutes.toString()),
          tl.status.minMessages.replace('{0}', config.minMessageCount.toString()),
          tl.status.requireVerification.replace('{0}', config.requireVerification ? tl.status.yes : tl.status.no),
          tl.status.actionThreshold.replace('{0}', (config.instantActionThreshold ?? 90).toString()),
        ].join('\n'),
      });
    }

    if ((config.whitelistedRoles?.length || 0) > 0 || (config.whitelistedUsers?.length || 0) > 0) {
      const whitelistInfo: string[] = [];

      if ((config.whitelistedRoles?.length || 0) > 0) {
        const rolesList = config.whitelistedRoles!.map(roleId => `<@&${roleId}>`).join(', ');
        whitelistInfo.push(`**Roles:** ${rolesList}`);
      }

      if ((config.whitelistedUsers?.length || 0) > 0) {
        const usersList = config.whitelistedUsers!.map(userId => `<@${userId}>`).join(', ');
        whitelistInfo.push(`**Users:** ${usersList}`);
      }

      embed.addFields({
        name: tl.status.whitelist,
        value: whitelistInfo.join('\n'),
      });
    }

    // Show test mode status
    if (config.testMode) {
      embed.addFields({
        name: 'Test Mode',
        value: 'Enabled — detections are logged but no real actions taken',
        inline: true,
      });
    }

    await interaction.reply({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, tl.error.fetchStatus);
  }
}

import { type ChatInputCommandInteraction, type Client, EmbedBuilder, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { BaitChannelConfig } from '../../../typeorm/entities/bait/BaitChannelConfig';
import {
  fmt,
  getBaitChannelIds,
  handleInteractionError,
  lang,
  replyEphemeralError,
  safeDbOperation,
} from '../../../utils';

const tl = lang.baitChannel;

/**
 * Mentions shown per whitelist line; the rest are counted. 15 role and 15 user
 * mentions plus labels stay well under Discord's 1024-character field limit,
 * which a full whitelist (the dashboard allows 125 entries) would pass.
 */
const WHITELIST_PREVIEW = 15;

function mentionPreview(ids: string[], mention: (id: string) => string): string {
  const shown = ids.slice(0, WHITELIST_PREVIEW).map(mention).join(', ');
  const hidden = ids.length - WHITELIST_PREVIEW;
  return hidden > 0 ? `${shown} ${fmt(tl.status.whitelistMore, { count: hidden })}` : shown;
}

export async function statusHandler(_client: Client, interaction: ChatInputCommandInteraction) {
  try {
    const configRepo = AppDataSource.getRepository(BaitChannelConfig);
    const config = await safeDbOperation(
      () => configRepo.findOne({ where: { guildId: interaction.guildId! } }),
      'Find bait channel config',
    );

    if (!config) {
      await replyEphemeralError(interaction, tl.notConfigured);
      return;
    }

    const baitChannelIds = getBaitChannelIds(config);
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
          fmt(tl.status.minAccountAge, { days: config.minAccountAgeDays }),
          fmt(tl.status.minMembership, { minutes: config.minMembershipMinutes }),
          fmt(tl.status.minMessages, { count: config.minMessageCount }),
          fmt(tl.status.requireVerification, { value: config.requireVerification ? tl.status.yes : tl.status.no }),
          fmt(tl.status.actionThreshold, { threshold: config.instantActionThreshold ?? 90 }),
        ].join('\n'),
      });
    }

    if ((config.whitelistedRoles?.length || 0) > 0 || (config.whitelistedUsers?.length || 0) > 0) {
      const whitelistInfo: string[] = [];

      if ((config.whitelistedRoles?.length || 0) > 0) {
        const rolesList = mentionPreview(config.whitelistedRoles!, roleId => `<@&${roleId}>`);
        whitelistInfo.push(fmt(tl.status.whitelistRoles, { roles: rolesList }));
      }

      if ((config.whitelistedUsers?.length || 0) > 0) {
        const usersList = mentionPreview(config.whitelistedUsers!, userId => `<@${userId}>`);
        whitelistInfo.push(fmt(tl.status.whitelistUsers, { users: usersList }));
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

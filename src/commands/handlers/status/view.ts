import {
  type CacheType,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
  time,
} from 'discord.js';
import { Colors, lang, requireBotOwner } from '../../../utils';
import type { StatusManager } from '../../../utils/status/StatusManager';

const tl = lang.status;

export async function statusViewHandler(
  interaction: ChatInputCommandInteraction<CacheType>,
  statusManager: StatusManager,
) {
  const ownerCheck = requireBotOwner(interaction.user.id);
  if (!ownerCheck.allowed) {
    await interaction.reply({
      content: ownerCheck.message,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const status = await statusManager.getStatus();
  const levelLabel = tl.levels[status.level] || status.level;
  const isOverrideActive = statusManager.isManualOverrideActive(status);

  // Choose embed color based on level
  const color =
    status.level === 'operational'
      ? Colors.status.success
      : status.level === 'major-outage'
        ? Colors.status.error
        : status.level === 'maintenance'
          ? Colors.status.info
          : Colors.status.warning;

  const embed = new EmbedBuilder()
    .setTitle(tl.view.title)
    .setColor(color)
    .addFields(
      { name: tl.view.level, value: levelLabel, inline: true },
      {
        name: tl.view.message,
        value: status.message || tl.view.noMessage,
        inline: true,
      },
    )
    .setTimestamp();

  // Affected systems
  const systemsValue =
    status.affectedSystems && status.affectedSystems.length > 0
      ? status.affectedSystems.join(', ')
      : tl.view.noSystems;
  embed.addFields({ name: tl.view.systems, value: systemsValue, inline: true });

  // Started at
  if (status.startedAt) {
    embed.addFields({
      name: tl.view.startedAt,
      value: time(new Date(status.startedAt), 'R'),
      inline: true,
    });
  }

  // Updated by
  if (status.updatedBy) {
    embed.addFields({
      name: tl.view.updatedBy,
      value: `<@${status.updatedBy}>`,
      inline: true,
    });
  }

  // Manual override info
  embed.addFields({
    name: tl.view.manualOverride,
    value: isOverrideActive ? tl.view.active : tl.view.inactive,
    inline: true,
  });

  if (isOverrideActive && status.manualOverrideExpiresAt) {
    embed.addFields({
      name: tl.view.overrideExpires,
      value: time(new Date(status.manualOverrideExpiresAt), 'R'),
      inline: true,
    });
  }

  // Set description for operational
  if (status.level === 'operational') {
    embed.setDescription(tl.view.operational);
  }

  await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
}

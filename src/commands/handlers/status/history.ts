import { type CacheType, type ChatInputCommandInteraction, EmbedBuilder, MessageFlags, time } from 'discord.js';
import { MoreThan } from 'typeorm';
import { AppDataSource } from '../../../typeorm';
import { StatusIncident } from '../../../typeorm/entities/status';
import { Colors, enhancedLogger, handleInteractionError, LogCategory, lang, requireBotOwner } from '../../../utils';

const tl = lang.status;

export async function statusHistoryHandler(interaction: ChatInputCommandInteraction<CacheType>) {
  const ownerCheck = requireBotOwner(interaction.user.id);
  if (!ownerCheck.allowed) {
    await interaction.reply({
      content: ownerCheck.message,
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  try {
    const days = interaction.options.getInteger('days') ?? 7;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const incidentRepo = AppDataSource.getRepository(StatusIncident);
    const incidents = await incidentRepo.find({
      where: { startedAt: MoreThan(cutoff) },
      order: { startedAt: 'DESC' },
      take: 25,
    });

    if (incidents.length === 0) {
      await interaction.reply({
        content: tl.history.noIncidents.replace('{days}', String(days)),
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const embed = new EmbedBuilder().setTitle(tl.history.title).setColor(Colors.status.info);

    for (const incident of incidents) {
      const levelLabel = tl.levels[incident.level as keyof typeof tl.levels] || incident.level;
      const started = time(new Date(incident.startedAt), 'R');

      let value = `${tl.history.started}: ${started}`;

      if (incident.resolvedAt) {
        const resolved = time(new Date(incident.resolvedAt), 'R');
        value += `\n${tl.history.resolved}: ${resolved}`;

        const durationMs = new Date(incident.resolvedAt).getTime() - new Date(incident.startedAt).getTime();
        value += `\n${tl.history.duration}: ${formatDuration(durationMs)}`;

        if (incident.resolvedBy) {
          value += `\n${tl.history.resolvedBy}: <@${incident.resolvedBy}>`;
        }
      } else {
        value += `\n**${tl.history.ongoing}**`;
      }

      if (incident.affectedSystems && incident.affectedSystems.length > 0) {
        value += `\n${tl.view.systems}: ${incident.affectedSystems.join(', ')}`;
      }

      embed.addFields({
        name: `${levelLabel} — ${incident.message}`,
        value,
      });
    }

    await interaction.reply({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral],
    });

    enhancedLogger.info('Status history viewed', LogCategory.COMMAND_EXECUTION, {
      userId: interaction.user.id,
      days,
      incidentCount: incidents.length,
    });
  } catch (error) {
    await handleInteractionError(interaction, error, 'statusHistoryHandler');
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

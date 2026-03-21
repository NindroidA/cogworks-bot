/**
 * Import Status/History/Cancel Subcommand Handler
 *
 * - status: Show currently running import
 * - history: Show past imports for this guild
 * - cancel: Cancel a running import
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder, MessageFlags } from 'discord.js';
import { lang } from '../../../utils';
import { importManager } from '../../../utils/import/importManager';

const tl = lang.import.commands;

export const importStatusHandler = async (
  interaction: ChatInputCommandInteraction,
  subcommand: string,
): Promise<void> => {
  const guildId = interaction.guildId!;

  switch (subcommand) {
    case 'status': {
      const running = importManager.getRunningImport(guildId);
      if (!running) {
        await interaction.reply({
          content: tl.noImportRunning,
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      const elapsed = Date.now() - running.startedAt.getTime();
      const embed = new EmbedBuilder()
        .setTitle(tl.statusTitle)
        .addFields(
          { name: 'Source', value: running.source, inline: true },
          { name: 'Data Type', value: running.dataType, inline: true },
          { name: 'Status', value: running.status, inline: true },
          { name: 'Imported', value: String(running.importedCount), inline: true },
          { name: 'Elapsed', value: `${(elapsed / 1000).toFixed(1)}s`, inline: true },
        )
        .setColor(0xf39c12)
        .setTimestamp();

      await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
      break;
    }

    case 'history': {
      const history = await importManager.getHistory(guildId);

      if (history.length === 0) {
        await interaction.reply({
          content: tl.noHistory,
          flags: [MessageFlags.Ephemeral],
        });
        return;
      }

      const embed = new EmbedBuilder().setTitle(tl.historyTitle).setColor(0x3498db).setTimestamp();

      for (const log of history.slice(0, 10)) {
        const statusEmoji =
          log.status === 'completed'
            ? '\u2705'
            : log.status === 'failed'
              ? '\u274c'
              : log.status === 'cancelled'
                ? '\u23f9\ufe0f'
                : '\u23f3';

        const duration = log.durationMs ? `${(log.durationMs / 1000).toFixed(1)}s` : 'N/A';
        const timestamp = Math.floor(log.startedAt.getTime() / 1000);

        embed.addFields({
          name: `${statusEmoji} ${log.source} (${log.dataType})`,
          value: `<t:${timestamp}:R> | Imported: ${log.importedCount} | Skipped: ${log.skippedCount} | Failed: ${log.failedCount} | ${duration}`,
        });
      }

      await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
      break;
    }

    case 'cancel': {
      const cancelled = await importManager.cancelImport(guildId);
      if (cancelled) {
        await interaction.reply({
          content: tl.importCancelled,
          flags: [MessageFlags.Ephemeral],
        });
      } else {
        await interaction.reply({
          content: tl.noImportRunning,
          flags: [MessageFlags.Ephemeral],
        });
      }
      break;
    }
  }
};

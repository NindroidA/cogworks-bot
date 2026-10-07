/**
 * MEE6 Import Subcommand Handler
 *
 * Imports XP data from the public MEE6 leaderboard API.
 * Admin-only, rate limited (1 per guild per hour).
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder, MessageFlags } from 'discord.js';
import { enhancedLogger, fmt, LogCategory, lang, replyEphemeralError, toUnixSeconds } from '../../../utils';
import { importManager } from '../../../utils/import/importManager';

const tl = lang.import.commands;

export async function mee6ImportHandler(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId!;
  const overwrite = interaction.options.getBoolean('overwrite') ?? false;
  const dryRun = interaction.options.getBoolean('dry-run') ?? false;

  // Check if an import is already running
  if (importManager.isRunning(guildId)) {
    await replyEphemeralError(interaction, tl.importAlreadyRunning);
    return;
  }

  // Check cooldown
  const cooldownUntil = await importManager.checkCooldown(guildId, dryRun);
  if (cooldownUntil) {
    const timestamp = toUnixSeconds(cooldownUntil);
    await interaction.reply({
      content: fmt(tl.importCooldown, { time: `<t:${timestamp}:R>` }),
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Defer reply — imports can take a while
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  enhancedLogger.info(
    `MEE6 import initiated by ${interaction.user.tag} for guild ${guildId}`,
    LogCategory.COMMAND_EXECUTION,
    { overwrite, dryRun },
  );

  await interaction.editReply({
    content: fmt(tl.importStarted, { source: 'MEE6' }),
  });

  const result = await importManager.startImport(guildId, 'mee6', 'xp', interaction.user.id, {
    overwrite,
    dryRun,
  });

  if (dryRun) {
    const embed = new EmbedBuilder()
      .setTitle(lang.import.results.mee6DryRunTitle)
      .setDescription(
        fmt(tl.dryRunComplete, { imported: result.imported, skipped: result.skipped, failed: result.failed }),
      )
      .setColor(0x3498db);

    if (result.errors.length > 0) {
      embed.addFields({
        name: lang.import.results.errorsField,
        value: result.errors.slice(0, 10).join('\n').substring(0, 1024),
      });
    }

    await interaction.editReply({ content: '', embeds: [embed] });
    return;
  }

  if (result.success) {
    const embed = new EmbedBuilder()
      .setTitle(lang.import.results.mee6CompleteTitle)
      .setDescription(
        fmt(tl.importComplete, { imported: result.imported, skipped: result.skipped, failed: result.failed }),
      )
      .setColor(0x2ecc71)
      .addFields({
        name: lang.import.results.durationField,
        value: `${(result.durationMs / 1000).toFixed(1)}s`,
        inline: true,
      });

    if (result.errors.length > 0) {
      embed.addFields({
        name: lang.import.results.warningsField,
        value: result.errors.slice(0, 10).join('\n').substring(0, 1024),
      });
    }

    await interaction.editReply({ content: '', embeds: [embed] });
  } else {
    const errorMsg = result.errors.length > 0 ? result.errors[0] : lang.import.results.unknownError;
    await replyEphemeralError(interaction, fmt(tl.importFailed, { error: errorMsg }));
  }
}

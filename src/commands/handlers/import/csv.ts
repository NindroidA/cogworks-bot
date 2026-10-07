/**
 * CSV Import Subcommand Handler
 *
 * Imports data from a CSV file attachment.
 * Admin-only, rate limited (1 per guild per hour).
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder, MessageFlags } from 'discord.js';
import {
  enhancedLogger,
  fmt,
  LogCategory,
  lang,
  logHandlerError,
  replyEphemeralError,
  toUnixSeconds,
} from '../../../utils';
import { importManager } from '../../../utils/import/importManager';

const tl = lang.import.commands;

export async function csvImportHandler(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId!;
  const overwrite = interaction.options.getBoolean('overwrite') ?? false;
  const dryRun = interaction.options.getBoolean('dry-run') ?? false;
  const attachment = interaction.options.getAttachment('file', true);

  // Validate attachment
  if (!attachment.name.endsWith('.csv')) {
    await replyEphemeralError(interaction, tl.csvRequired);
    return;
  }

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

  // Download CSV content
  let csvContent: string;
  try {
    const response = await fetch(attachment.url);
    if (!response.ok) {
      await replyEphemeralError(interaction, fmt(tl.importFailed, { error: 'Failed to download CSV file.' }));
      return;
    }
    csvContent = await response.text();
  } catch (error) {
    logHandlerError('CSV attachment download', error, { guildId });
    await replyEphemeralError(interaction, fmt(tl.importFailed, { error: 'Failed to download CSV file.' }));
    return;
  }

  enhancedLogger.info(
    `CSV import initiated by ${interaction.user.tag} for guild ${guildId}`,
    LogCategory.COMMAND_EXECUTION,
    {
      overwrite,
      dryRun,
      fileSize: attachment.size,
    },
  );

  await interaction.editReply({
    content: fmt(tl.importStarted, { source: 'CSV' }),
  });

  // The content travels with this call: the importer is shared by every guild.
  const result = await importManager.startImport(guildId, 'csv', 'xp', interaction.user.id, {
    overwrite,
    dryRun,
    content: csvContent,
  });

  if (dryRun) {
    const embed = new EmbedBuilder()
      .setTitle(lang.import.results.csvDryRunTitle)
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
      .setTitle(lang.import.results.csvCompleteTitle)
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

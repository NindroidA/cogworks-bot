/**
 * CSV Import Subcommand Handler
 *
 * Imports data from a CSV file attachment.
 * Admin-only, rate limited (1 per guild per hour).
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder, MessageFlags } from 'discord.js';
import { enhancedLogger, formatLang, LogCategory, lang, replyEphemeralError, toUnixSeconds } from '../../../utils';
import type { CsvImporter } from '../../../utils/import/csvImporter';
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
  const cooldownUntil = await importManager.checkCooldown(guildId);
  if (cooldownUntil) {
    const timestamp = toUnixSeconds(cooldownUntil);
    await interaction.reply({
      content: formatLang(tl.importCooldown, `<t:${timestamp}:R>`),
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
      await replyEphemeralError(interaction, formatLang(tl.importFailed, 'Failed to download CSV file.'));
      return;
    }
    csvContent = await response.text();
  } catch (error) {
    enhancedLogger.error(
      'Failed to download CSV attachment',
      error instanceof Error ? error : undefined,
      LogCategory.COMMAND_EXECUTION,
      { guildId },
    );
    await replyEphemeralError(interaction, formatLang(tl.importFailed, 'Failed to download CSV file.'));
    return;
  }

  // Set CSV content on the importer
  const csvImporter = importManager.getImporter('csv') as CsvImporter;
  csvImporter.csvContent = csvContent;

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
    content: formatLang(tl.importStarted, 'CSV'),
  });

  const result = await importManager.startImport(guildId, 'csv', 'xp', interaction.user.id, {
    overwrite,
    dryRun,
  });

  if (dryRun) {
    const embed = new EmbedBuilder()
      .setTitle('CSV Import — Dry Run')
      .setDescription(formatLang(tl.dryRunComplete, result.imported, result.skipped, result.failed))
      .setColor(0x3498db);

    if (result.errors.length > 0) {
      embed.addFields({
        name: 'Errors',
        value: result.errors.slice(0, 10).join('\n').substring(0, 1024),
      });
    }

    await interaction.editReply({ content: '', embeds: [embed] });
    return;
  }

  if (result.success) {
    const embed = new EmbedBuilder()
      .setTitle('CSV Import Complete')
      .setDescription(formatLang(tl.importComplete, result.imported, result.skipped, result.failed))
      .setColor(0x2ecc71)
      .addFields({
        name: 'Duration',
        value: `${(result.durationMs / 1000).toFixed(1)}s`,
        inline: true,
      });

    if (result.errors.length > 0) {
      embed.addFields({
        name: 'Warnings',
        value: result.errors.slice(0, 10).join('\n').substring(0, 1024),
      });
    }

    await interaction.editReply({ content: '', embeds: [embed] });
  } else {
    const errorMsg = result.errors.length > 0 ? result.errors[0] : 'Unknown error';
    await replyEphemeralError(interaction, formatLang(tl.importFailed, errorMsg));
  }
}

/**
 * Data Export Command Handler
 *
 * GDPR Compliance: Exports all guild data to gzipped JSON
 * Security: Admin-only, rate limited to 1 delivered export per 24 hours
 */

import { gzipSync } from 'node:zlib';
import {
  AttachmentBuilder,
  type CacheType,
  type ChatInputCommandInteraction,
  type Client,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import {
  createRateLimitKey,
  enhancedLogger,
  formatBytes,
  formatLang,
  guardAdminRateLimit,
  LogCategory,
  lang,
  RateLimits,
  rateLimiter,
  replyEphemeralError,
} from '../../utils';
import { fetchAllExportData, MAX_EXPORT_ATTACHMENT_BYTES } from '../../utils/offboarding/guildDataExport';

/**
 * Handle data export command
 * Exports all guild data to gzipped JSON and sends it via DM, falling back to
 * an attachment on the ephemeral reply when the DM can't be delivered.
 */
export async function dataExportHandler(
  _client: Client,
  interaction: ChatInputCommandInteraction<CacheType>,
): Promise<void> {
  // Set once the guard spends today's export; any path that doesn't deliver a file gives it back.
  let rateLimitKey: string | undefined;
  try {
    const tl = lang.dataExport;
    const guildId = interaction.guildId;
    if (!guildId) {
      await replyEphemeralError(interaction, tl.guildOnly);
      return;
    }

    const guard = await guardAdminRateLimit(interaction, {
      action: 'data-export',
      limit: RateLimits.DATA_EXPORT,
      scope: 'guild',
    });
    if (!guard.allowed) return;
    rateLimitKey = createRateLimitKey.guild(guildId, 'data-export');

    // Defer reply as export may take time
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    enhancedLogger.info(formatLang(tl.starting, guildId, interaction.user.tag), LogCategory.COMMAND_EXECUTION);

    const exportData = await fetchAllExportData(guildId);

    // Calculate total records
    const totalRecords = Object.values(exportData).reduce((sum, arr) => sum + arr.length, 0);

    // Create export metadata
    const exportMetadata = {
      exportedAt: new Date().toISOString(),
      guildId,
      guildName: interaction.guild?.name || 'Unknown',
      requestedBy: {
        id: interaction.user.id,
        tag: interaction.user.tag,
      },
      totalRecords,
      tables: Object.keys(exportData).length,
      recordCounts: Object.fromEntries(Object.entries(exportData).map(([key, arr]) => [key, arr.length])),
    };

    const fullExport = {
      metadata: exportMetadata,
      data: exportData,
    };

    // Compact + gzip: pretty-printed JSON of a busy guild easily passes Discord's upload cap.
    const buffer = gzipSync(Buffer.from(JSON.stringify(fullExport)));
    const filename = `guild-${guildId}-export-${Date.now()}.json.gz`;

    enhancedLogger.info(
      formatLang(tl.completed, totalRecords.toString(), Object.keys(exportData).length.toString()),
      LogCategory.COMMAND_EXECUTION,
    );

    if (buffer.length > MAX_EXPORT_ATTACHMENT_BYTES) {
      rateLimiter.reset(rateLimitKey);
      await interaction.editReply({ content: formatLang(tl.tooLarge, formatBytes(buffer.length)) });
      return;
    }

    // Send file via DM
    try {
      const dmChannel = await interaction.user.createDM();

      const embed = new EmbedBuilder()
        .setTitle(tl.exportTitle)
        .setDescription(formatLang(tl.exportDescription, interaction.guild?.name || 'Unknown'))
        .addFields(
          {
            name: tl.totalRecords,
            value: totalRecords.toString(),
            inline: true,
          },
          {
            name: tl.tables,
            value: Object.keys(exportData).length.toString(),
            inline: true,
          },
          {
            name: tl.exportedAt,
            value: new Date().toLocaleString(),
            inline: true,
          },
        )
        .setColor(0x00ff00)
        .setFooter({ text: tl.footer });

      await dmChannel.send({
        embeds: [embed],
        files: [new AttachmentBuilder(buffer, { name: filename })],
      });

      await interaction.editReply({
        content: tl.dmSuccess,
      });
    } catch (dmError) {
      enhancedLogger.warn(
        formatLang(tl.dmFailedLog, interaction.user.tag, (dmError as Error).message),
        LogCategory.COMMAND_EXECUTION,
      );

      // Fallback: the deferred reply is ephemeral, so only the requesting admin sees the file.
      await interaction.editReply({ content: tl.dmFailed, files: [new AttachmentBuilder(buffer, { name: filename })] });
    }
  } catch (error) {
    if (rateLimitKey) rateLimiter.reset(rateLimitKey);
    enhancedLogger.error(`Error in data export: ${(error as Error).message}`, undefined, LogCategory.COMMAND_EXECUTION);

    const errorContent = lang.dataExport.error;

    if (interaction.deferred) {
      await interaction.editReply({ content: errorContent });
    } else {
      await interaction.reply({
        content: errorContent,
        flags: [MessageFlags.Ephemeral],
      });
    }
  }
}

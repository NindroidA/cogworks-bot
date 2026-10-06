/**
 * Archive Cleanup Handler
 *
 * Exports archived data (including transcript text), DMs it to the admin,
 * then optionally deletes the exported entries and their forum threads.
 * Nothing is offered for deletion unless the DM was delivered.
 */

import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  type CacheType,
  type ChatInputCommandInteraction,
  type Client,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import {
  createButtonCollector,
  createRateLimitKey,
  enhancedLogger,
  formatBytes,
  guardAdminRateLimit,
  handleInteractionError,
  LogCategory,
  type RateLimitConfig,
  RateLimits,
  rateLimiter,
} from '../../../utils';
import {
  type ArchiveDeleteResult,
  type ArchiveSystem,
  deleteArchivedEntries,
  exportArchives,
} from '../../../utils/archive/archiveExporter';
import { Colors } from '../../../utils/colors';
import { MAX_EXPORT_ATTACHMENT_BYTES } from '../../../utils/offboarding/guildDataExport';

/** Same budget as /data-export (the export is the expensive part), with its own wording. */
const ARCHIVE_CLEANUP_LIMIT: RateLimitConfig = {
  ...RateLimits.DATA_EXPORT,
  message: '⏱️ `/archive cleanup` can only export once per day. Please try again tomorrow.',
};

export async function archiveCleanupHandler(client: Client, interaction: ChatInputCommandInteraction<CacheType>) {
  try {
    const guard = await guardAdminRateLimit(interaction, {
      action: 'archive-cleanup',
      limit: ARCHIVE_CLEANUP_LIMIT,
      scope: 'guild',
    });
    if (!guard.allowed) return;

    if (!interaction.guildId) return;
    const guildId = interaction.guildId;
    // Give the daily export back on any path that doesn't deliver a file.
    const releaseLimit = () => rateLimiter.reset(createRateLimitKey.guild(guildId, 'archive-cleanup'));

    const system = interaction.options.getString('system', true) as ArchiveSystem;

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    // Export archives (reads every transcript thread; can take a while)
    const result = await exportArchives(guildId, system, client).catch(error => {
      releaseLimit();
      throw error;
    });

    if (result.entryCount === 0) {
      releaseLimit();
      await interaction.editReply({
        content: `No archived ${system === 'all' ? 'entries' : system} found to export.`,
      });
      return;
    }

    const sizeFormatted = formatBytes(result.compressedSizeBytes);

    // DM the archive to the admin
    const tooLarge = result.compressedSizeBytes > MAX_EXPORT_ATTACHMENT_BYTES;
    let dmSent = false;
    if (!tooLarge) {
      try {
        const attachment = new AttachmentBuilder(result.buffer, { name: result.filename });
        await interaction.user.send({
          content: `**Archive Export** — ${system}\n${result.entryCount} entries (${sizeFormatted})`,
          files: [attachment],
        });
        dmSent = true;
      } catch {
        enhancedLogger.warn('Failed to DM archive file', LogCategory.COMMAND_EXECUTION, {
          guildId,
          userId: interaction.user.id,
        });
      }
    }

    if (!dmSent) {
      releaseLimit();
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(Colors.severity.medium)
            .setTitle('Archive Not Delivered')
            .setDescription(
              (tooLarge
                ? `The archive is ${sizeFormatted}, over Discord's 8 MB upload limit, and can't be split into parts yet. ` +
                  (system === 'all' ? 'Try one system at a time. ' : '')
                : `Couldn't DM you the archive (${sizeFormatted}). Turn on DMs from server members and run the command again. `) +
                'Nothing was deleted.',
            ),
        ],
      });
      return;
    }

    const deletableCount = result.deletable.tickets.length + result.deletable.applications.length;
    const keptNote =
      result.unreadableCount > 0
        ? `\n\n${result.unreadableCount} transcript thread(s) couldn't be read, so they and their records will be kept.`
        : '';

    // Ask about cleanup
    const cleanupEmbed = new EmbedBuilder()
      .setColor(Colors.status.info)
      .setTitle('Archive Exported')
      .setDescription(
        'Archive sent to your DMs. It includes the transcript text; attachment files are not included.\n\n' +
          `**${result.entryCount}** entries exported (${sizeFormatted})${keptNote}\n\n` +
          `Delete ${deletableCount} exported entries **and their forum threads** from Discord? This can't be undone. ` +
          'A thread that gets a new message before you confirm is kept.',
      );

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('archive_delete_yes')
        .setLabel('Yes, Delete Archives')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('archive_delete_no').setLabel('No, Keep Them').setStyle(ButtonStyle.Secondary),
    );

    const reply = await interaction.editReply({
      embeds: [cleanupEmbed],
      components: [buttons],
    });

    const collector = createButtonCollector(reply, 60_000);

    collector.on('collect', async btn => {
      collector.stop();

      if (btn.customId === 'archive_delete_yes') {
        const deleteResult: ArchiveDeleteResult = { deleted: 0, threadsDeleted: 0, kept: 0 };
        try {
          // Defer first — deletion can take time (forum threads, DB records)
          await btn.update({
            content: 'Deleting archived entries...',
            embeds: [],
            components: [],
          });
          await deleteArchivedEntries(guildId, result.deletable, client, deleteResult);
        } catch (error) {
          enhancedLogger.error('Archive cleanup stopped part-way', error as Error, LogCategory.COMMAND_EXECUTION, {
            guildId,
            system,
            ...deleteResult,
          });
          await btn
            .editReply({
              content:
                `Archive cleanup stopped after an error. ${deleteResult.deleted} records and ` +
                `${deleteResult.threadsDeleted} threads were deleted before it, and the rest were kept. ` +
                'The file in your DMs still has all of them.',
              embeds: [],
              components: [],
            })
            .catch(() => undefined);
          return;
        }

        // The deletion already finished: a failed summary edit (Discord 5xx, expired token) is only logged.
        try {
          await btn.editReply({
            content: null,
            embeds: [
              new EmbedBuilder()
                .setColor(Colors.status.success)
                .setTitle('Archive Cleanup Complete')
                .addFields(
                  {
                    name: 'Exported',
                    value: `${result.entryCount} entries`,
                    inline: true,
                  },
                  {
                    name: 'Deleted',
                    value: `${deleteResult.deleted} records, ${deleteResult.threadsDeleted} threads`,
                    inline: true,
                  },
                  {
                    name: 'Kept',
                    value: `${deleteResult.kept + result.unreadableCount} (thread unreadable, undeletable or updated since the export)`,
                    inline: true,
                  },
                ),
            ],
          });
        } catch (error) {
          enhancedLogger.warn(
            'Archive cleanup finished but its summary could not be shown',
            LogCategory.COMMAND_EXECUTION,
            {
              guildId,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }

        enhancedLogger.info('Archive cleanup completed', LogCategory.COMMAND_EXECUTION, {
          guildId,
          system,
          exported: result.entryCount,
          deleted: deleteResult.deleted,
          kept: deleteResult.kept,
          userId: interaction.user.id,
        });
      } else {
        await btn.update({
          content: 'Archives kept. The exported file was still sent to your DMs.',
          embeds: [],
          components: [],
        });
      }
    });

    collector.on('end', async (collected, reason) => {
      if (reason === 'time' && collected.size === 0) {
        try {
          await interaction.editReply({
            content: 'Archive cleanup timed out. Archives were not deleted.',
            embeds: [],
            components: [],
          });
        } catch {}
      }
    });
  } catch (error) {
    await handleInteractionError(interaction, error, 'Archive cleanup');
  }
}

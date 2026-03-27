/**
 * Archive Cleanup Handler
 *
 * Exports archived data, DMs it to the admin, then optionally deletes
 * the archived entries from the database.
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
  enhancedLogger,
  formatBytes,
  guardAdminRateLimit,
  handleInteractionError,
  LogCategory,
  RateLimits,
} from '../../../utils';
import { type ArchiveSystem, deleteArchivedEntries, exportArchives } from '../../../utils/archive/archiveExporter';
import { Colors } from '../../../utils/colors';

export const archiveCleanupHandler = async (client: Client, interaction: ChatInputCommandInteraction<CacheType>) => {
  try {
    const guard = await guardAdminRateLimit(interaction, {
      action: 'archive-cleanup',
      limit: RateLimits.DATA_EXPORT,
      scope: 'guild',
    });
    if (!guard.allowed) return;

    if (!interaction.guildId) return;
    const guildId = interaction.guildId;

    const system = interaction.options.getString('system', true) as ArchiveSystem;

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    // Export archives
    const result = await exportArchives(guildId, system);

    if (result.entryCount === 0) {
      await interaction.editReply({
        content: `No archived ${system === 'all' ? 'entries' : system} found to export.`,
      });
      return;
    }

    const sizeFormatted = formatBytes(result.compressedSizeBytes);

    // DM the archive to the admin
    let dmSent = false;
    try {
      const attachment = new AttachmentBuilder(result.buffer, {
        name: result.filename,
      });
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

    // Ask about cleanup
    const cleanupEmbed = new EmbedBuilder()
      .setColor(Colors.status.info)
      .setTitle('Archive Exported')
      .setDescription(
        `${dmSent ? 'Archive sent to your DMs.' : 'Failed to DM archive — check your DM settings.'}\n\n` +
          `**${result.entryCount}** entries exported (${sizeFormatted})\n\n` +
          'Would you like to delete these archived entries from the database?',
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
        // Defer first — deletion can take time (forum threads, DB records)
        await btn.update({
          content: 'Deleting archived entries...',
          embeds: [],
          components: [],
        });

        const deleteResult = await deleteArchivedEntries(guildId, system, client);

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
                  value: `${deleteResult.deleted} records`,
                  inline: true,
                },
                { name: 'DM', value: dmSent ? 'Sent' : 'Failed', inline: true },
              ),
          ],
        });

        enhancedLogger.info('Archive cleanup completed', LogCategory.COMMAND_EXECUTION, {
          guildId,
          system,
          exported: result.entryCount,
          deleted: deleteResult.deleted,
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
};

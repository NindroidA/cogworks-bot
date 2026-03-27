import { type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { ArchivedApplication } from '../../../typeorm/entities/application/ArchivedApplication';
import { enhancedLogger, handleInteractionError, LogCategory, lang, requireAdmin } from '../../../utils';

/**
 * Delete a specific archived application by user
 * Also deletes the forum post
 */
export async function deleteArchivedApplicationHandler(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    // Admin-only command
    const ownerCheck = requireAdmin(interaction);
    if (!ownerCheck.allowed) {
      await interaction.reply({
        content: ownerCheck.message,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    if (!interaction.guild) {
      await interaction.reply({
        content: lang.general.cmdGuildNotFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const user = interaction.options.getUser('user', true);
    const guildId = interaction.guild.id;
    const archivedAppRepo = AppDataSource.getRepository(ArchivedApplication);

    const archivedApp = await archivedAppRepo.findOne({
      where: { guildId, createdBy: user.id },
    });

    if (!archivedApp) {
      await interaction.reply({
        content: lang.dev.deleteArchivedApplication.notFound.replace('{user}', user.tag),
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Try to delete the forum post
    let forumPostDeleted = false;
    try {
      if (!archivedApp.messageId) throw new Error('No messageId');
      const channel = await interaction.client.channels.fetch(archivedApp.messageId);
      if (channel?.isThread()) {
        await channel.delete();
        forumPostDeleted = true;
      }
    } catch (error) {
      enhancedLogger.warn('Failed to delete forum post', LogCategory.COMMAND_EXECUTION, { error: String(error) });
      // Continue anyway to delete database record
    }

    // Delete database record
    await archivedAppRepo.remove(archivedApp);

    await interaction.reply({
      content: forumPostDeleted
        ? lang.dev.deleteArchivedApplication.successWithPost.replace('{user}', user.tag)
        : lang.dev.deleteArchivedApplication.successNoPost.replace('{user}', user.tag),
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, 'deleteArchivedApplicationHandler');
  }
}

/**
 * Delete ALL archived applications in the server
 * Also deletes all forum posts
 */
export async function deleteAllArchivedApplicationsHandler(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    // Admin-only command
    const ownerCheck = requireAdmin(interaction);
    if (!ownerCheck.allowed) {
      await interaction.reply({
        content: ownerCheck.message,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    if (!interaction.guild) {
      await interaction.reply({
        content: lang.general.cmdGuildNotFound,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const guildId = interaction.guild.id;
    const archivedAppRepo = AppDataSource.getRepository(ArchivedApplication);

    // Get all archived applications first
    const archivedApps = await archivedAppRepo.find({ where: { guildId } });

    let postsDeleted = 0;
    let postsFailed = 0;

    // Delete forum posts
    for (const app of archivedApps) {
      try {
        if (!app.messageId) {
          postsFailed++;
          continue;
        }
        const channel = await interaction.client.channels.fetch(app.messageId);
        if (channel?.isThread()) {
          await channel.delete();
          postsDeleted++;
        }
      } catch (error) {
        postsFailed++;
        enhancedLogger.warn('Failed to delete forum post', LogCategory.COMMAND_EXECUTION, {
          messageId: app.messageId,
          error: String(error),
        });
      }
    }

    // Delete database records
    const result = await archivedAppRepo.delete({ guildId });

    await interaction.editReply(
      `${lang.dev.deleteAllArchivedApplications.complete}\n\n` +
        `${lang.dev.deleteAllArchivedApplications.results}\n` +
        `${lang.dev.deleteAllArchivedApplications.dbRecordsDeleted.replace('{count}', (result.affected || 0).toString())}\n` +
        `${lang.dev.deleteAllArchivedApplications.forumPostsDeleted.replace('{count}', postsDeleted.toString())}\n` +
        `${lang.dev.deleteAllArchivedApplications.forumPostsFailed.replace('{count}', postsFailed.toString())}`,
    );
  } catch (error) {
    await handleInteractionError(interaction, error, 'deleteAllArchivedApplicationsHandler');
  }
}

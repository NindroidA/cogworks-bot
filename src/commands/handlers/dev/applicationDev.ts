import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../../typeorm';
import { ArchivedApplication } from '../../../typeorm/entities/application/ArchivedApplication';
import { handleInteractionError, lang, requireAdmin } from '../../../utils';

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
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        if (!interaction.guild) {
            await interaction.reply({
                content: lang.general.cmdGuildNotFound,
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        const user = interaction.options.getUser('user', true);
        const guildId = interaction.guild.id;
        const archivedAppRepo = AppDataSource.getRepository(ArchivedApplication);

        const archivedApp = await archivedAppRepo.findOne({
            where: { guildId, createdBy: user.id }
        });

        if (!archivedApp) {
            await interaction.reply({
                content: lang.dev.deleteArchivedApplication.notFound.replace('{user}', user.tag),
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        // Try to delete the forum post
        let forumPostDeleted = false;
        try {
            const channel = await interaction.client.channels.fetch(archivedApp.messageId);
            if (channel && channel.isThread()) {
                await channel.delete();
                forumPostDeleted = true;
            }
        } catch (error) {
            console.error('Failed to delete forum post:', error);
            // Continue anyway to delete database record
        }

        // Delete database record
        await archivedAppRepo.remove(archivedApp);

        await interaction.reply({
            content: forumPostDeleted
                ? lang.dev.deleteArchivedApplication.successWithPost.replace('{user}', user.tag)
                : lang.dev.deleteArchivedApplication.successNoPost.replace('{user}', user.tag),
            flags: [MessageFlags.Ephemeral]
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
                flags: [MessageFlags.Ephemeral]
            });
            return;
        }

        if (!interaction.guild) {
            await interaction.reply({
                content: lang.general.cmdGuildNotFound,
                flags: [MessageFlags.Ephemeral]
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
                const channel = await interaction.client.channels.fetch(app.messageId);
                if (channel && channel.isThread()) {
                    await channel.delete();
                    postsDeleted++;
                }
            } catch (error) {
                postsFailed++;
                console.error(`Failed to delete forum post ${app.messageId}:`, error);
            }
        }

        // Delete database records
        const result = await archivedAppRepo.delete({ guildId });

        await interaction.editReply(
            `${lang.dev.deleteAllArchivedApplications.complete}\n\n` +
            `${lang.dev.deleteAllArchivedApplications.results}\n` +
            `${lang.dev.deleteAllArchivedApplications.dbRecordsDeleted.replace('{count}', (result.affected || 0).toString())}\n` +
            `${lang.dev.deleteAllArchivedApplications.forumPostsDeleted.replace('{count}', postsDeleted.toString())}\n` +
            `${lang.dev.deleteAllArchivedApplications.forumPostsFailed.replace('{count}', postsFailed.toString())}`
        );
    } catch (error) {
        await handleInteractionError(interaction, error, 'deleteAllArchivedApplicationsHandler');
    }
}

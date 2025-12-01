import { ChatInputCommandInteraction, ForumChannel, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../typeorm';
import { ArchivedTicket } from '../../typeorm/entities/ticket/ArchivedTicket';
import { ArchivedTicketConfig } from '../../typeorm/entities/ticket/ArchivedTicketConfig';
import { CustomTicketType } from '../../typeorm/entities/ticket/CustomTicketType';
import { applyForumTags, ensureForumTag, handleInteractionError, lang, requireAdmin } from '../../utils';

/**
 * Migrate existing archived tickets to use forum tags
 * Available in both dev and production modes
 */
export async function migrateTicketTagsHandler(interaction: ChatInputCommandInteraction): Promise<void> {
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
        const client = interaction.client;
        const archivedTicketRepo = AppDataSource.getRepository(ArchivedTicket);
        const archivedConfigRepo = AppDataSource.getRepository(ArchivedTicketConfig);
        const customTicketTypeRepo = AppDataSource.getRepository(CustomTicketType);

        // Get archived config
        const archivedConfig = await archivedConfigRepo.findOneBy({ guildId });
        if (!archivedConfig) {
            await interaction.editReply('❌ No archived ticket config found');
            return;
        }

        // Get forum channel
        const forumChannel = await client.channels.fetch(archivedConfig.channelId) as ForumChannel;
        if (!forumChannel || !forumChannel.isThreadOnly()) {
            await interaction.editReply('❌ Archived ticket channel is not a forum channel');
            return;
        }

        // Get all archived tickets
        const archivedTickets = await archivedTicketRepo.find({
            where: { guildId }
        });

        let updated = 0;
        let skipped = 0;
        let errors = 0;

        for (const archived of archivedTickets) {
            try {
                let typeId: string | null = null;
                let displayName: string | null = null;
                let emoji: string | null = null;

                // Try to get type info
                if (archived.customTypeId) {
                    const customType = await customTicketTypeRepo.findOne({
                        where: { guildId, typeId: archived.customTypeId }
                    });
                    if (customType) {
                        typeId = customType.typeId;
                        displayName = customType.displayName;
                        emoji = customType.emoji;
                    }
                } else if (archived.ticketType) {
                    // Legacy type mapping
                    const legacyTypeMap: Record<string, { display: string; emoji: string }> = {
                        '18_verify': { display: '18+ Verification', emoji: '🔞' },
                        'ban_appeal': { display: 'Ban Appeal', emoji: '⚖️' },
                        'player_report': { display: 'Player Report', emoji: '📢' },
                        'bug_report': { display: 'Bug Report', emoji: '🐛' },
                        'other': { display: 'Other', emoji: '❓' }
                    };
                    const legacyInfo = legacyTypeMap[archived.ticketType];
                    if (legacyInfo) {
                        typeId = archived.ticketType;
                        displayName = legacyInfo.display;
                        emoji = legacyInfo.emoji;
                    }
                }

                if (!typeId || !displayName) {
                    skipped++;
                    continue;
                }

                // Create/find tag
                const tagId = await ensureForumTag(
                    forumChannel,
                    typeId,
                    displayName,
                    emoji || null
                );

                if (tagId) {
                    // Get existing tags
                    const existingTags = archived.forumTagIds || [];
                    
                    // Skip if already has this tag
                    if (existingTags.includes(tagId)) {
                        skipped++;
                        continue;
                    }

                    // Merge new tag with existing tags
                    const mergedTags = [...existingTags, tagId];

                    // Apply merged tags to forum post
                    await applyForumTags(forumChannel, archived.messageId, mergedTags);

                    // Update database with merged tags
                    archived.forumTagIds = mergedTags;
                    await archivedTicketRepo.save(archived);

                    updated++;
                }
            } catch (error) {
                console.error(`Error migrating ticket ${archived.id}:`, error);
                errors++;
            }
        }

        await interaction.editReply(
            '✅ Migration complete!\n' +
            '📊 **Results:**\n' +
            `• Updated: ${updated}\n` +
            `• Skipped: ${skipped}\n` +
            `• Errors: ${errors}`
        );
    } catch (error) {
        await handleInteractionError(interaction, error, 'migrateTicketTagsHandler');
    }
}

/**
 * Migrate existing archived applications to use forum tags
 * Not currently supported - applications don't have types/tags yet
 */
export async function migrateApplicationTagsHandler(interaction: ChatInputCommandInteraction): Promise<void> {
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

        await interaction.reply({
            content: '❌ Applications don\'t currently support custom types or forum tags.\n' +
                'This command is only available for tickets.',
            flags: [MessageFlags.Ephemeral]
        });
    } catch (error) {
        await handleInteractionError(interaction, error, 'migrateApplicationTagsHandler');
    }
}

import { type ChatInputCommandInteraction, type ForumChannel, MessageFlags } from 'discord.js';
import { AppDataSource } from '../../typeorm';
import { ArchivedTicket } from '../../typeorm/entities/ticket/ArchivedTicket';
import { ArchivedTicketConfig } from '../../typeorm/entities/ticket/ArchivedTicketConfig';
import { CustomTicketType } from '../../typeorm/entities/ticket/CustomTicketType';
import {
  applyForumTags,
  enhancedLogger,
  ensureForumTag,
  guardAdmin,
  handleInteractionError,
  LogCategory,
} from '../../utils';
import { builtinTypeInfo } from '../../utils/ticket/builtinTypes';

/**
 * Migrate existing archived tickets to use forum tags
 * Available in both dev and production modes
 */
export async function migrateTicketTagsHandler(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    const guard = await guardAdmin(interaction);
    if (!guard.allowed) return;

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    const guildId = interaction.guildId!;
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
    const forumChannel = (await client.channels.fetch(archivedConfig.channelId)) as ForumChannel;
    if (!forumChannel?.isThreadOnly()) {
      await interaction.editReply('❌ Archived ticket channel is not a forum channel');
      return;
    }

    // Get all archived tickets
    const archivedTickets = await archivedTicketRepo.find({
      where: { guildId },
    });

    // Batch-fetch all custom ticket types for this guild into a Map (avoids N+1 queries)
    const allCustomTypes = await customTicketTypeRepo.find({
      where: { guildId },
    });
    const customTypeMap = new Map(allCustomTypes.map(ct => [ct.typeId, ct]));

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
          const customType = customTypeMap.get(archived.customTypeId) ?? null;
          if (customType) {
            typeId = customType.typeId;
            displayName = customType.displayName;
            emoji = customType.emoji;
          }
        } else if (archived.ticketType) {
          const builtinInfo = builtinTypeInfo(archived.ticketType);
          if (builtinInfo) {
            typeId = builtinInfo.typeId;
            displayName = builtinInfo.displayName;
            emoji = builtinInfo.emoji;
          }
        }

        if (!typeId || !displayName) {
          skipped++;
          continue;
        }

        // Create/find tag
        const tagId = await ensureForumTag(forumChannel, typeId, displayName, emoji || null);

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
          if (!archived.messageId) {
            skipped++;
            continue;
          }
          const applied = await applyForumTags(forumChannel, archived.messageId, mergedTags);

          // Persist only if the tag actually reached the thread — otherwise the
          // includes-guard above would skip every future attempt while the
          // thread never shows the tag (5-tag cap / apply failure).
          if (applied?.includes(tagId)) {
            archived.forumTagIds = mergedTags;
            await archivedTicketRepo.save(archived);
            updated++;
          } else {
            skipped++;
          }
        }
      } catch (error) {
        enhancedLogger.error(`Error migrating ticket ${archived.id}`, error as Error, LogCategory.DATABASE);
        errors++;
      }
    }

    await interaction.editReply(
      `✅ Migration complete!\n📊 **Results:**\n• Updated: ${updated}\n• Skipped: ${skipped}\n• Errors: ${errors}`,
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
    const guard = await guardAdmin(interaction);
    if (!guard.allowed) return;

    await interaction.reply({
      content:
        "❌ Applications don't currently support custom types or forum tags.\n" +
        'This command is only available for tickets.',
      flags: [MessageFlags.Ephemeral],
    });
  } catch (error) {
    await handleInteractionError(interaction, error, 'migrateApplicationTagsHandler');
  }
}

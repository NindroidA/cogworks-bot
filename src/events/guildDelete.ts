/**
 * Guild Delete Event Handler
 *
 * Handles the bot being removed from a guild/server.
 * GDPR Compliance: Deletes all guild data when bot is removed.
 */

import type { Client, Guild } from 'discord.js';
import { AppDataSource } from '../typeorm';
import { BotStatus } from '../typeorm/entities/status';
import { enhancedLogger, LogCategory } from '../utils';
import { notifyGuildLeave } from '../utils/api/guildWebhook';
import { deleteAllGuildData } from '../utils/database/guildQueries';
import { invalidateBaitCaches } from '../utils/offboarding/guildCaches';

export default {
  name: 'guildDelete',
  async execute(guild: Guild, client: Client) {
    try {
      const guildName = guild.name;
      const guildId = guild.id;
      const memberCount = guild.memberCount;

      enhancedLogger.guildEvent(`Left guild: ${guildName} (ID: ${guildId}) - Members: ${memberCount}`, guildId);
      enhancedLogger.info(`Starting GDPR-compliant data deletion for guild ${guildId}...`, LogCategory.DATABASE);

      // deleteAllGuildData drops the other per-guild caches itself. The bait caches live on the
      // client, so clear them here on both sides of the purge: a kick-and-reinvite inside their
      // TTL would otherwise keep acting on the purged bait config.
      invalidateBaitCaches(client, guildId);

      // Delete all guild data from database
      const deletionResult = await deleteAllGuildData(guildId);
      invalidateBaitCaches(client, guildId);

      if (deletionResult.success) {
        enhancedLogger.info(
          `Successfully deleted ${deletionResult.total} records across ${deletionResult.tables} tables for guild ${guildName}`,
          LogCategory.DATABASE,
          { guildId, details: deletionResult.details },
        );
      } else {
        enhancedLogger.error(`Failed to delete data for guild ${guildName}`, undefined, LogCategory.DATABASE, {
          guildId,
          error: deletionResult.error,
        });
        enhancedLogger.warn('Manual cleanup may be required', LogCategory.DATABASE, { guildId });
      }

      // GDPR: Clear updatedBy in BotStatus if it references a user from this guild
      try {
        const statusRepo = AppDataSource.getRepository(BotStatus);
        const status = await statusRepo.findOneBy({ id: 1 });
        if (status?.updatedBy) {
          status.updatedBy = null;
          await statusRepo.save(status);
        }
      } catch {
        // BotStatus clearing is best-effort
      }

      // Notify API (fire-and-forget) — skip for dev guild
      if (guildId !== process.env.DEV_GUILD_ID) {
        // Intentional: fire-and-forget API notification
        notifyGuildLeave(guildId).catch(() => {});
      }

      // Log final bot statistics
      enhancedLogger.info(`Bot now serving ${client.guilds.cache.size} servers`, LogCategory.SYSTEM);
    } catch (error) {
      enhancedLogger.error(
        `Error handling guild delete for ${guild.name} (${guild.id})`,
        error as Error,
        LogCategory.DATABASE,
        {
          guildId: guild.id,
        },
      );
      enhancedLogger.warn(
        'Guild data may not have been fully deleted - manual cleanup required',
        LogCategory.DATABASE,
        { guildId: guild.id },
      );
    }
  },
};

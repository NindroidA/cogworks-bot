/**
 * Guild Delete Event Handler
 *
 * Handles the bot being removed from a guild/server.
 * GDPR Compliance: Deletes all guild data when bot is removed.
 */

import type { Client, Guild } from 'discord.js';
import { AppDataSource } from '../typeorm';
import { BotStatus } from '../typeorm/entities/status';
import { enhancedLogger, invalidateGuildMenuCache, LogCategory } from '../utils';
import { deleteAllGuildData } from '../utils/database/guildQueries';
import { invalidateRulesCache } from './rulesReaction';

export default {
  name: 'guildDelete',
  async execute(guild: Guild, client: Client) {
    try {
      const guildName = guild.name;
      const guildId = guild.id;
      const memberCount = guild.memberCount;

      enhancedLogger.guildEvent(
        `Left guild: ${guildName} (ID: ${guildId}) - Members: ${memberCount}`,
        guildId,
      );
      enhancedLogger.info(
        `Starting GDPR-compliant data deletion for guild ${guildId}...`,
        LogCategory.DATABASE,
      );

      // Invalidate in-memory caches for this guild
      invalidateRulesCache(guildId);
      invalidateGuildMenuCache(guildId);

      // Delete all guild data from database
      const deletionResult = await deleteAllGuildData(guildId);

      if (deletionResult.success) {
        enhancedLogger.info(
          `Successfully deleted ${deletionResult.total} records across ${deletionResult.tables} tables for guild ${guildName}`,
          LogCategory.DATABASE,
          { guildId, details: deletionResult.details },
        );
      } else {
        enhancedLogger.error(
          `Failed to delete data for guild ${guildName}`,
          undefined,
          LogCategory.DATABASE,
          { guildId, error: deletionResult.error },
        );
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

      // Log final bot statistics
      enhancedLogger.info(
        `Bot now serving ${client.guilds.cache.size} servers`,
        LogCategory.SYSTEM,
      );
    } catch (error) {
      enhancedLogger.error(
        `Error handling guild delete for ${guild.name} (${guild.id})`,
        error as Error,
        LogCategory.DATABASE,
        { guildId: guild.id },
      );
      enhancedLogger.warn(
        'Guild data may not have been fully deleted - manual cleanup required',
        LogCategory.DATABASE,
        { guildId: guild.id },
      );
    }
  },
};

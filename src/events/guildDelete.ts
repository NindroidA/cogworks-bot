/**
 * Guild Delete Event Handler
 *
 * Handles the bot being removed from a guild/server.
 * GDPR Compliance: Deletes all guild data when bot is removed.
 */

import type { Client, Guild } from 'discord.js';
import { AppDataSource } from '../typeorm';
import { BotStatus } from '../typeorm/entities/status';
import { invalidateGuildMenuCache, logger } from '../utils';
import { deleteAllGuildData } from '../utils/database/guildQueries';
import { invalidateRulesCache } from './rulesReaction';

export default {
  name: 'guildDelete',
  async execute(guild: Guild, client: Client) {
    try {
      const guildName = guild.name;
      const guildId = guild.id;
      const memberCount = guild.memberCount;

      logger(`Left guild: ${guildName} (ID: ${guildId}) - Members: ${memberCount}`, 'INFO');
      logger(`Starting GDPR-compliant data deletion for guild ${guildId}...`, 'INFO');

      // Invalidate in-memory caches for this guild
      invalidateRulesCache(guildId);
      invalidateGuildMenuCache(guildId);

      // Delete all guild data from database
      const deletionResult = await deleteAllGuildData(guildId);

      if (deletionResult.success) {
        logger(
          `✅ Successfully deleted ${deletionResult.total} records across ${deletionResult.tables} tables for guild ${guildName}`,
          'INFO',
        );

        // Log detailed deletion breakdown
        logger('Deletion breakdown:', 'INFO');
        for (const [table, count] of Object.entries(deletionResult.details)) {
          if (count > 0) {
            logger(`  - ${table}: ${count} records`, 'INFO');
          }
        }
      } else {
        logger(`❌ Failed to delete data for guild ${guildName}: ${deletionResult.error}`, 'ERROR');
        logger('⚠️  Manual cleanup may be required', 'WARN');
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
      logger(`Bot now serving ${client.guilds.cache.size} servers`, 'INFO');
    } catch (error) {
      logger(
        `Error handling guild delete for ${guild.name} (${guild.id}): ${(error as Error).message}`,
        'ERROR',
      );
      logger('⚠️  Guild data may not have been fully deleted - manual cleanup required', 'WARN');
    }
  },
};

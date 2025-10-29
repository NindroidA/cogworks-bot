/**
 * Guild Delete Event Handler
 * 
 * Handles the bot being removed from a guild/server.
 * GDPR Compliance: Deletes all guild data when bot is removed.
 */

import { Client, Guild } from 'discord.js';
import { logger } from '../utils';
import { deleteAllGuildData } from '../utils/database/guildQueries';

export default {
	name: 'guildDelete',
	async execute(guild: Guild, client: Client) {
		try {
			const guildName = guild.name;
			const guildId = guild.id;
			const memberCount = guild.memberCount;

			logger(`Left guild: ${guildName} (ID: ${guildId}) - Members: ${memberCount}`, 'INFO');
			logger(`Starting GDPR-compliant data deletion for guild ${guildId}...`, 'INFO');

			// Delete all guild data from database
			const deletionResult = await deleteAllGuildData(guildId);

			if (deletionResult.success) {
				logger(
					`✅ Successfully deleted ${deletionResult.total} records across ${deletionResult.tables} tables for guild ${guildName}`,
					'INFO'
				);

				// Log detailed deletion breakdown
				logger('Deletion breakdown:', 'INFO');
				for (const [table, count] of Object.entries(deletionResult.details)) {
					if (count > 0) {
						logger(`  - ${table}: ${count} records`, 'INFO');
					}
				}
			} else {
				logger(
					`❌ Failed to delete data for guild ${guildName}: ${deletionResult.error}`,
					'ERROR'
				);
				logger('⚠️  Manual cleanup may be required', 'WARN');
			}

			// Log final bot statistics
			logger(`Bot now serving ${client.guilds.cache.size} servers`, 'INFO');

		} catch (error) {
			logger(
				`Error handling guild delete for ${guild.name} (${guild.id}): ${(error as Error).message}`,
				'ERROR'
			);
			logger('⚠️  Guild data may not have been fully deleted - manual cleanup required', 'WARN');
		}
	}
};

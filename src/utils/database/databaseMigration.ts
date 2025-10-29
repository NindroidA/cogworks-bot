/**
 * Database Migration Utility
 * 
 * This file contains database migration scripts for multi-server deployment.
 * 
 * TODO: Remove this file after migration is complete on production server
 * 
 * Migration adds:
 * - guildId column to Application and Ticket entities
 * - Database indexes on all guildId columns for performance
 */

import { AppDataSource } from '../../typeorm';
import { logger } from '../index';

/**
 * Run database migration for multi-server support
 * 
 * This migration:
 * 1. Adds guildId column to applications table
 * 2. Adds guildId column to tickets table
 * 3. Adds guildId column to archived_applications table
 * 4. Adds guildId column to archived_tickets table
 * 5. Populates guildId from related config tables
 * 6. Adds indexes on all guildId columns
 */
export async function runMultiServerMigration(): Promise<void> {
	try {
		logger('Starting multi-server database migration...', 'INFO');

		if (!AppDataSource.isInitialized) {
			await AppDataSource.initialize();
		}

		const queryRunner = AppDataSource.createQueryRunner();
		await queryRunner.connect();

		// Check if migration has already been run
		const applicationsHasGuildId = await queryRunner.hasColumn('applications', 'guildId');
		const ticketsHasGuildId = await queryRunner.hasColumn('tickets', 'guildId');
		const archivedAppsHasGuildId = await queryRunner.hasColumn('archived_applications', 'guildId');
		const archivedTicketsHasGuildId = await queryRunner.hasColumn('archived_tickets', 'guildId');

		if (applicationsHasGuildId && ticketsHasGuildId && archivedAppsHasGuildId && archivedTicketsHasGuildId) {
			logger('Migration already completed - guildId columns exist', 'INFO');
			await queryRunner.release();
			return;
		}

		await queryRunner.startTransaction();

		try {
			// Migration 1: Add guildId to applications table
			if (!applicationsHasGuildId) {
				logger('Adding guildId column to applications table...', 'INFO');
				
				// Add column
				await queryRunner.query(`
					ALTER TABLE applications 
					ADD COLUMN guildId VARCHAR(255) NULL
				`);

				// Populate guildId from application_configs via channelId
				// This assumes channelId is unique per guild (which it should be)
				await queryRunner.query(`
					UPDATE applications a
					INNER JOIN application_configs ac ON a.channelId LIKE CONCAT(ac.categoryId, '%')
					SET a.guildId = ac.guildId
					WHERE a.guildId IS NULL AND ac.categoryId IS NOT NULL
				`);

				// For applications without a match, we'll need to handle manually
				// Set a default or delete them - let's log them
				const orphanedApps = await queryRunner.query(`
					SELECT id, channelId, createdBy 
					FROM applications 
					WHERE guildId IS NULL
				`);

				if (orphanedApps.length > 0) {
					logger(`Found ${orphanedApps.length} applications without guildId - these may need manual review`, 'WARN');
				}

				// Make guildId NOT NULL after population
				await queryRunner.query(`
					ALTER TABLE applications 
					MODIFY COLUMN guildId VARCHAR(255) NOT NULL
				`);

				logger('✅ Added guildId to applications table', 'INFO');
			}

			// Migration 2: Add guildId to tickets table
			if (!ticketsHasGuildId) {
				logger('Adding guildId column to tickets table...', 'INFO');
				
				// Add column
				await queryRunner.query(`
					ALTER TABLE tickets 
					ADD COLUMN guildId VARCHAR(255) NULL
				`);

				// Populate guildId from ticket_configs via channelId
				await queryRunner.query(`
					UPDATE tickets t
					INNER JOIN ticket_configs tc ON t.channelId LIKE CONCAT(tc.categoryId, '%')
					SET t.guildId = tc.guildId
					WHERE t.guildId IS NULL AND tc.categoryId IS NOT NULL
				`);

				// Log orphaned tickets
				const orphanedTickets = await queryRunner.query(`
					SELECT id, channelId, createdBy 
					FROM tickets 
					WHERE guildId IS NULL
				`);

				if (orphanedTickets.length > 0) {
					logger(`Found ${orphanedTickets.length} tickets without guildId - these may need manual review`, 'WARN');
				}

				// Make guildId NOT NULL after population
				await queryRunner.query(`
					ALTER TABLE tickets 
					MODIFY COLUMN guildId VARCHAR(255) NOT NULL
				`);

				logger('✅ Added guildId to tickets table', 'INFO');
			}

			// Migration 3: Add guildId to archived_applications table
			if (!archivedAppsHasGuildId) {
				logger('Adding guildId column to archived_applications table...', 'INFO');
				
				await queryRunner.query(`
					ALTER TABLE archived_applications 
					ADD COLUMN guildId VARCHAR(255) NULL
				`);

				// Populate from archived_application_configs via messageId match
				await queryRunner.query(`
					UPDATE archived_applications aa
					INNER JOIN archived_application_configs aac ON aa.messageId = aac.messageId
					SET aa.guildId = aac.guildId
					WHERE aa.guildId IS NULL
				`);

				await queryRunner.query(`
					ALTER TABLE archived_applications 
					MODIFY COLUMN guildId VARCHAR(255) NOT NULL
				`);

				logger('✅ Added guildId to archived_applications table', 'INFO');
			}

			// Migration 4: Add guildId to archived_tickets table
			if (!archivedTicketsHasGuildId) {
				logger('Adding guildId column to archived_tickets table...', 'INFO');
				
				await queryRunner.query(`
					ALTER TABLE archived_tickets 
					ADD COLUMN guildId VARCHAR(255) NULL
				`);

				// Populate from archived_ticket_configs via messageId match
				await queryRunner.query(`
					UPDATE archived_tickets at
					INNER JOIN archived_ticket_configs atc ON at.messageId = atc.messageId
					SET at.guildId = atc.guildId
					WHERE at.guildId IS NULL
				`);

				await queryRunner.query(`
					ALTER TABLE archived_tickets 
					MODIFY COLUMN guildId VARCHAR(255) NOT NULL
				`);

				logger('✅ Added guildId to archived_tickets table', 'INFO');
			}

			// Migration 5: Add indexes for performance
			logger('Creating indexes on guildId columns...', 'INFO');

			const indexesToCreate = [
				{ table: 'bot_configs', columns: ['guildId'], name: 'IDX_bot_configs_guildId' },
				{ table: 'bait_channel_configs', columns: ['guildId'], name: 'IDX_bait_channel_configs_guildId' },
				{ table: 'bait_channel_logs', columns: ['guildId', 'createdAt'], name: 'IDX_bait_channel_logs_guildId_createdAt' },
				{ table: 'staff_roles', columns: ['guildId'], name: 'IDX_staff_roles_guildId' },
				{ table: 'AnnouncementConfig', columns: ['guildId'], name: 'IDX_announcement_config_guildId' },
				{ table: 'applications', columns: ['guildId'], name: 'IDX_applications_guildId' },
				{ table: 'application_configs', columns: ['guildId'], name: 'IDX_application_configs_guildId' },
				{ table: 'positions', columns: ['guildId', 'isActive'], name: 'IDX_positions_guildId_isActive' },
				{ table: 'archived_application_configs', columns: ['guildId'], name: 'IDX_archived_application_configs_guildId' },
				{ table: 'archived_applications', columns: ['guildId'], name: 'IDX_archived_applications_guildId' },
				{ table: 'tickets', columns: ['guildId', 'status'], name: 'IDX_tickets_guildId_status' },
				{ table: 'ticket_configs', columns: ['guildId'], name: 'IDX_ticket_configs_guildId' },
				{ table: 'archived_ticket_configs', columns: ['guildId'], name: 'IDX_archived_ticket_configs_guildId' },
				{ table: 'archived_tickets', columns: ['guildId'], name: 'IDX_archived_tickets_guildId' },
				{ table: 'user_activity', columns: ['guildId', 'userId'], name: 'IDX_user_activity_guildId_userId' },
			];

			for (const index of indexesToCreate) {
				const indexExists = await queryRunner.query(`
					SHOW INDEX FROM ${index.table} WHERE Key_name = '${index.name}'
				`);

				if (indexExists.length === 0) {
					const columnList = index.columns.join(', ');
					await queryRunner.query(`
						CREATE INDEX ${index.name} ON ${index.table} (${columnList})
					`);
					logger(`✅ Created index ${index.name} on ${index.table}`, 'INFO');
				} else {
					logger(`Index ${index.name} already exists on ${index.table}`, 'INFO');
				}
			}

			await queryRunner.commitTransaction();
			logger('✅ Multi-server migration completed successfully!', 'INFO');
			logger('⚠️  Remember to remove src/utils/databaseMigration.ts after confirming migration', 'WARN');

		} catch (error) {
			await queryRunner.rollbackTransaction();
			logger('❌ Migration failed, rolled back changes', 'ERROR');
			throw error;
		} finally {
			await queryRunner.release();
		}

	} catch (error) {
		logger('Error during migration: ' + (error as Error).message, 'ERROR');
		throw error;
	}
}

/**
 * CLI script to run migration
 * Usage: ts-node src/utils/databaseMigration.ts
 */
if (require.main === module) {
	runMultiServerMigration()
		.then(() => {
			logger('Migration completed. You can now start the bot.', 'INFO');
			process.exit(0);
		})
		.catch((error) => {
			logger('Migration failed: ' + error.message, 'ERROR');
			process.exit(1);
		});
}

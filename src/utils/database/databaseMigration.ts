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

				// Populate guildId from application_configs
				// Since there's only one guild in your current setup, get it from application_configs
				const configGuildId = await queryRunner.query(`
					SELECT guildId FROM application_configs LIMIT 1
				`);

				if (configGuildId.length > 0) {
					await queryRunner.query(`
						UPDATE applications 
						SET guildId = '${configGuildId[0].guildId}'
						WHERE guildId IS NULL
					`);
					logger(`Set guildId to ${configGuildId[0].guildId} for all applications`, 'INFO');
				} else {
					logger('No application config found - cannot populate guildId', 'ERROR');
					throw new Error('Cannot migrate: no application config exists');
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

				// Populate guildId from ticket_configs
				const configGuildId = await queryRunner.query(`
					SELECT guildId FROM ticket_configs LIMIT 1
				`);

				if (configGuildId.length > 0) {
					await queryRunner.query(`
						UPDATE tickets 
						SET guildId = '${configGuildId[0].guildId}'
						WHERE guildId IS NULL
					`);
					logger(`Set guildId to ${configGuildId[0].guildId} for all tickets`, 'INFO');
				} else {
					logger('No ticket config found - cannot populate guildId', 'ERROR');
					throw new Error('Cannot migrate: no ticket config exists');
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

				// Populate from archived_application_configs
				const configGuildId = await queryRunner.query(`
					SELECT guildId FROM archived_application_configs LIMIT 1
				`);

				if (configGuildId.length > 0) {
					await queryRunner.query(`
						UPDATE archived_applications 
						SET guildId = '${configGuildId[0].guildId}'
						WHERE guildId IS NULL
					`);
					logger(`Set guildId to ${configGuildId[0].guildId} for all archived applications`, 'INFO');
				} else {
					logger('No archived application config found - cannot populate guildId', 'ERROR');
					throw new Error('Cannot migrate: no archived application config exists');
				}

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

				// Populate from archived_ticket_configs
				const configGuildId = await queryRunner.query(`
					SELECT guildId FROM archived_ticket_configs LIMIT 1
				`);

				if (configGuildId.length > 0) {
					await queryRunner.query(`
						UPDATE archived_tickets 
						SET guildId = '${configGuildId[0].guildId}'
						WHERE guildId IS NULL
					`);
					logger(`Set guildId to ${configGuildId[0].guildId} for all archived tickets`, 'INFO');
				} else {
					logger('No archived ticket config found - cannot populate guildId', 'ERROR');
					throw new Error('Cannot migrate: no archived ticket config exists');
				}

				await queryRunner.query(`
					ALTER TABLE archived_tickets 
					MODIFY COLUMN guildId VARCHAR(255) NOT NULL
				`);

				logger('✅ Added guildId to archived_tickets table', 'INFO');
			}

			// Migration 5: Add indexes for performance
			logger('Creating indexes on guildId columns...', 'INFO');

			const indexesToCreate = [
				// Only create indexes on tables that don't already have UNIQUE constraints or existing indexes
				// Config tables already have UNIQUE(guildId), so skip those
				{ table: 'applications', columns: ['guildId'], name: 'IDX_applications_guildId' },
				{ table: 'positions', columns: ['guildId', 'isActive'], name: 'IDX_positions_guildId_isActive' },
				{ table: 'archived_applications', columns: ['guildId'], name: 'IDX_archived_applications_guildId' },
				{ table: 'tickets', columns: ['guildId', 'status'], name: 'IDX_tickets_guildId_status' },
				{ table: 'archived_tickets', columns: ['guildId'], name: 'IDX_archived_tickets_guildId' },
				{ table: 'staff_roles', columns: ['guildId'], name: 'IDX_staff_roles_guildId' },
				{ table: 'announcement_log', columns: ['guildId'], name: 'IDX_announcement_log_guildId' },
			];

			for (const index of indexesToCreate) {
				try {
					// Check if table exists first
					const tableExists = await queryRunner.query(`
						SHOW TABLES LIKE '${index.table}'
					`);

					if (tableExists.length === 0) {
						logger(`Skipping ${index.table} - table does not exist`, 'INFO');
						continue;
					}

					// Check if any index exists on the guildId column(s)
					const existingIndexes = await queryRunner.query(`
						SHOW INDEX FROM ${index.table} WHERE Column_name IN (${index.columns.map(c => `'${c}'`).join(',')})
					`);

					if (existingIndexes.length === 0) {
						const columnList = index.columns.join(', ');
						await queryRunner.query(`
							CREATE INDEX ${index.name} ON ${index.table} (${columnList})
						`);
						logger(`✅ Created index ${index.name} on ${index.table}`, 'INFO');
					} else {
						logger(`Index already exists on ${index.table}(${index.columns.join(', ')})`, 'INFO');
					}
				} catch (error) {
					logger(`⚠️  Could not create index on ${index.table}: ${(error as Error).message}`, 'WARN');
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

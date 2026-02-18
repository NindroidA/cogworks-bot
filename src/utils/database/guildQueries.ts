/**
 * Database Query Utilities
 *
 * Utilities for safe, guild-scoped database queries to prevent cross-guild data leaks.
 * All queries should use these helpers to ensure proper guild isolation.
 */

import type { FindManyOptions, FindOneOptions, FindOptionsWhere, Repository } from 'typeorm';
import { logger } from '../index';

/**
 * Safely find one entity scoped to a specific guild
 *
 * @param repo - TypeORM repository
 * @param guildId - Guild ID to scope the query to
 * @param options - Additional find options (merged with guildId filter)
 * @returns Entity or null
 *
 * @example
 * const config = await findOneByGuild(ticketConfigRepo, guildId, {
 *   select: ['channelId', 'categoryId']
 * });
 */
export async function findOneByGuild<T extends { guildId: string }>(
  repo: Repository<T>,
  guildId: string,
  options?: Omit<FindOneOptions<T>, 'where'>,
): Promise<T | null> {
  try {
    return await repo.findOne({
      ...options,
      where: { guildId } as FindOptionsWhere<T>,
    });
  } catch (error) {
    logger(
      `Error in findOneByGuild for ${repo.metadata.name}: ${(error as Error).message}`,
      'ERROR',
    );
    return null;
  }
}

/**
 * Safely find multiple entities scoped to a specific guild
 *
 * @param repo - TypeORM repository
 * @param guildId - Guild ID to scope the query to
 * @param options - Additional find options (merged with guildId filter)
 * @returns Array of entities
 *
 * @example
 * const tickets = await findManyByGuild(ticketRepo, guildId, {
 *   where: { status: 'open' },
 *   order: { createdAt: 'DESC' },
 *   take: 10
 * });
 */
export async function findManyByGuild<T extends { guildId: string }>(
  repo: Repository<T>,
  guildId: string,
  options?: Omit<FindManyOptions<T>, 'where'> & {
    where?: Omit<FindOptionsWhere<T>, 'guildId'>;
  },
): Promise<T[]> {
  try {
    const { where, ...restOptions } = options || {};

    return await repo.find({
      ...restOptions,
      where: {
        ...(where as object),
        guildId,
      } as FindOptionsWhere<T>,
    });
  } catch (error) {
    logger(
      `Error in findManyByGuild for ${repo.metadata.name}: ${(error as Error).message}`,
      'ERROR',
    );
    return [];
  }
}

/**
 * Safely count entities scoped to a specific guild
 *
 * @param repo - TypeORM repository
 * @param guildId - Guild ID to scope the query to
 * @param options - Additional count options (merged with guildId filter)
 * @returns Count of entities
 *
 * @example
 * const openTicketCount = await countByGuild(ticketRepo, guildId, {
 *   where: { status: 'open' }
 * });
 */
export async function countByGuild<T extends { guildId: string }>(
  repo: Repository<T>,
  guildId: string,
  options?: Omit<FindManyOptions<T>, 'where'> & {
    where?: Omit<FindOptionsWhere<T>, 'guildId'>;
  },
): Promise<number> {
  try {
    const { where, ...restOptions } = options || {};

    return await repo.count({
      ...restOptions,
      where: {
        ...(where as object),
        guildId,
      } as FindOptionsWhere<T>,
    });
  } catch (error) {
    logger(`Error in countByGuild for ${repo.metadata.name}: ${(error as Error).message}`, 'ERROR');
    return 0;
  }
}

/**
 * Safely delete entities scoped to a specific guild
 *
 * @param repo - TypeORM repository
 * @param guildId - Guild ID to scope the deletion to
 * @param additionalWhere - Additional where conditions (merged with guildId filter)
 * @returns Delete result
 *
 * @example
 * // Delete all closed tickets for a guild
 * await deleteByGuild(ticketRepo, guildId, { status: 'closed' });
 */
export async function deleteByGuild<T extends { guildId: string }>(
  repo: Repository<T>,
  guildId: string,
  additionalWhere?: Omit<FindOptionsWhere<T>, 'guildId'>,
): Promise<{ affected: number }> {
  try {
    const result = await repo.delete({
      ...(additionalWhere as object),
      guildId,
    } as FindOptionsWhere<T>);

    return { affected: result.affected || 0 };
  } catch (error) {
    logger(
      `Error in deleteByGuild for ${repo.metadata.name}: ${(error as Error).message}`,
      'ERROR',
    );
    return { affected: 0 };
  }
}

/**
 * Safely delete ALL data for a specific guild (GDPR compliance)
 *
 * ⚠️ DANGEROUS: This deletes all data for a guild across all tables
 * Use only when a guild removes the bot
 *
 * @param guildId - Guild ID to delete all data for
 * @returns Object with deletion counts per entity
 *
 * @example
 * const result = await deleteAllGuildData(guildId);
 * console.log(`Deleted ${result.total} records across ${result.tables} tables`);
 */
export async function deleteAllGuildData(guildId: string): Promise<{
  success: boolean;
  total: number;
  tables: number;
  details: Record<string, number>;
  error?: string;
}> {
  try {
    // Import repositories (circular dependency safe)
    const { AppDataSource } = await import('../../typeorm');
    const { BotConfig } = await import('../../typeorm/entities/BotConfig');
    const { TicketConfig } = await import('../../typeorm/entities/ticket/TicketConfig');
    const { ArchivedTicketConfig } = await import(
      '../../typeorm/entities/ticket/ArchivedTicketConfig'
    );
    const { Ticket } = await import('../../typeorm/entities/ticket/Ticket');
    const { ArchivedTicket } = await import('../../typeorm/entities/ticket/ArchivedTicket');
    const { ApplicationConfig } = await import(
      '../../typeorm/entities/application/ApplicationConfig'
    );
    const { ArchivedApplicationConfig } = await import(
      '../../typeorm/entities/application/ArchivedApplicationConfig'
    );
    const { Application } = await import('../../typeorm/entities/application/Application');
    const { ArchivedApplication } = await import(
      '../../typeorm/entities/application/ArchivedApplication'
    );
    const { Position } = await import('../../typeorm/entities/application/Position');
    const { AnnouncementConfig } = await import(
      '../../typeorm/entities/announcement/AnnouncementConfig'
    );
    const { BaitChannelConfig } = await import('../../typeorm/entities/BaitChannelConfig');
    const { BaitChannelLog } = await import('../../typeorm/entities/BaitChannelLog');
    const { SavedRole } = await import('../../typeorm/entities/SavedRole');
    const { UserActivity } = await import('../../typeorm/entities/UserActivity');
    const { RulesConfig } = await import('../../typeorm/entities/rules');
    const { ReactionRoleMenu } = await import('../../typeorm/entities/reactionRole');

    const details: Record<string, number> = {};
    let total = 0;

    // Delete from all tables
    const deletions = [
      { name: 'BotConfig', repo: AppDataSource.getRepository(BotConfig) },
      { name: 'TicketConfig', repo: AppDataSource.getRepository(TicketConfig) },
      { name: 'ArchivedTicketConfig', repo: AppDataSource.getRepository(ArchivedTicketConfig) },
      { name: 'Ticket', repo: AppDataSource.getRepository(Ticket) },
      { name: 'ArchivedTicket', repo: AppDataSource.getRepository(ArchivedTicket) },
      { name: 'ApplicationConfig', repo: AppDataSource.getRepository(ApplicationConfig) },
      {
        name: 'ArchivedApplicationConfig',
        repo: AppDataSource.getRepository(ArchivedApplicationConfig),
      },
      { name: 'Application', repo: AppDataSource.getRepository(Application) },
      { name: 'ArchivedApplication', repo: AppDataSource.getRepository(ArchivedApplication) },
      { name: 'Position', repo: AppDataSource.getRepository(Position) },
      { name: 'AnnouncementConfig', repo: AppDataSource.getRepository(AnnouncementConfig) },
      { name: 'BaitChannelConfig', repo: AppDataSource.getRepository(BaitChannelConfig) },
      { name: 'BaitChannelLog', repo: AppDataSource.getRepository(BaitChannelLog) },
      { name: 'SavedRole', repo: AppDataSource.getRepository(SavedRole) },
      { name: 'UserActivity', repo: AppDataSource.getRepository(UserActivity) },
      { name: 'RulesConfig', repo: AppDataSource.getRepository(RulesConfig) },
      { name: 'ReactionRoleMenu', repo: AppDataSource.getRepository(ReactionRoleMenu) },
    ];

    for (const { name, repo } of deletions) {
      const result = await deleteByGuild(repo as Repository<{ guildId: string }>, guildId);
      details[name] = result.affected;
      total += result.affected;
    }

    return {
      success: true,
      total,
      tables: Object.keys(details).length,
      details,
    };
  } catch (error) {
    logger(
      `Error in deleteAllGuildData for guildId ${guildId}: ${(error as Error).message}`,
      'ERROR',
    );

    return {
      success: false,
      total: 0,
      tables: 0,
      details: {},
      error: (error as Error).message,
    };
  }
}

/**
 * Verify that a guild ID is valid and exists in bot configs
 *
 * @param guildId - Guild ID to verify
 * @returns True if guild exists in database
 *
 * @example
 * if (!await verifyGuildExists(guildId)) {
 *   await interaction.reply('This server is not configured. Run /botsetup first.');
 *   return;
 * }
 */
export async function verifyGuildExists(guildId: string): Promise<boolean> {
  try {
    const { AppDataSource } = await import('../../typeorm');
    const { BotConfig } = await import('../../typeorm/entities/BotConfig');

    const config = await AppDataSource.getRepository(BotConfig).findOne({
      where: { guildId },
    });

    return config !== null;
  } catch (error) {
    logger(
      `Error in verifyGuildExists for guildId ${guildId}: ${(error as Error).message}`,
      'ERROR',
    );
    return false;
  }
}

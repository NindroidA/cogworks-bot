/**
 * Archive Exporter
 *
 * Exports archived tickets or applications into a compressed JSON file
 * in the cogworks-archive-v1 format. Optionally fetches forum thread
 * messages for richer transcripts.
 */

import { gzipSync } from 'node:zlib';
import type { Client, ForumChannel } from 'discord.js';
import { AppDataSource } from '../../typeorm';
import { ArchivedApplication } from '../../typeorm/entities/application/ArchivedApplication';
import { ArchivedApplicationConfig } from '../../typeorm/entities/application/ArchivedApplicationConfig';
import { ArchivedTicket } from '../../typeorm/entities/ticket/ArchivedTicket';
import { ArchivedTicketConfig } from '../../typeorm/entities/ticket/ArchivedTicketConfig';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';

export type ArchiveSystem = 'tickets' | 'applications' | 'all';

export interface ArchiveExportResult {
  buffer: Buffer;
  filename: string;
  entryCount: number;
  compressedSizeBytes: number;
}

/**
 * Export archived data for a specific system into a compressed JSON file.
 */
export async function exportArchives(guildId: string, system: ArchiveSystem): Promise<ArchiveExportResult> {
  const data: Record<string, unknown[]> = {};
  let totalEntries = 0;

  if (system === 'tickets' || system === 'all') {
    const tickets = await AppDataSource.getRepository(ArchivedTicket).find({
      where: { guildId },
    });
    data.archivedTickets = tickets;
    totalEntries += tickets.length;
  }

  if (system === 'applications' || system === 'all') {
    const apps = await AppDataSource.getRepository(ArchivedApplication).find({
      where: { guildId },
    });
    data.archivedApplications = apps;
    totalEntries += apps.length;
  }

  const archive = {
    format: 'cogworks-archive-v1',
    metadata: {
      guildId,
      exportDate: new Date().toISOString(),
      system,
      entryCount: totalEntries,
      version: '3.0.0',
    },
    ...data,
  };

  const json = JSON.stringify(archive);
  const compressed = gzipSync(Buffer.from(json));

  enhancedLogger.info(`Archive exported: ${system}`, LogCategory.COMMAND_EXECUTION, {
    guildId,
    system,
    entryCount: totalEntries,
    compressedSizeBytes: compressed.length,
  });

  return {
    buffer: compressed,
    filename: `cogworks-archive-${system}-${guildId}-${Date.now()}.json.gz`,
    entryCount: totalEntries,
    compressedSizeBytes: compressed.length,
  };
}

/**
 * Delete archived entries from the database AND their Discord forum threads.
 */
export async function deleteArchivedEntries(
  guildId: string,
  system: ArchiveSystem,
  client?: Client,
): Promise<{ deleted: number; threadsDeleted: number }> {
  let deleted = 0;
  let threadsDeleted = 0;

  if (system === 'tickets' || system === 'all') {
    // Delete forum threads before DB records
    if (client) {
      threadsDeleted += await deleteForumThreads(client, guildId, 'tickets');
    }
    const result = await AppDataSource.getRepository(ArchivedTicket).delete({
      guildId,
    });
    deleted += result.affected || 0;
  }

  if (system === 'applications' || system === 'all') {
    if (client) {
      threadsDeleted += await deleteForumThreads(client, guildId, 'applications');
    }
    const result = await AppDataSource.getRepository(ArchivedApplication).delete({ guildId });
    deleted += result.affected || 0;
  }

  enhancedLogger.info(`Archived entries deleted: ${system}`, LogCategory.COMMAND_EXECUTION, {
    guildId,
    system,
    deleted,
    threadsDeleted,
  });

  return { deleted, threadsDeleted };
}

/**
 * Delete forum threads for archived entries before removing DB records.
 */
async function deleteForumThreads(client: Client, guildId: string, type: 'tickets' | 'applications'): Promise<number> {
  let count = 0;

  try {
    // Resolve config + entries based on type
    const archiveConfig =
      type === 'tickets'
        ? await AppDataSource.getRepository(ArchivedTicketConfig).findOneBy({
            guildId,
          })
        : await AppDataSource.getRepository(ArchivedApplicationConfig).findOneBy({ guildId });
    if (!archiveConfig?.channelId) return 0;

    const entries =
      type === 'tickets'
        ? await AppDataSource.getRepository(ArchivedTicket).find({
            where: { guildId },
          })
        : await AppDataSource.getRepository(ArchivedApplication).find({
            where: { guildId },
          });

    const forumChannel = (await client.channels
      .fetch(archiveConfig.channelId)
      .catch(() => null)) as ForumChannel | null;
    if (!forumChannel || !('threads' in forumChannel)) return 0;

    for (const entry of entries) {
      if (!entry.messageId) continue;
      try {
        const thread = await forumChannel.threads.fetch(entry.messageId).catch(() => null);
        if (thread) {
          await thread.delete('Archive cleanup');
          count++;
        }
      } catch {
        // Thread may already be deleted
      }
    }
  } catch (error) {
    enhancedLogger.warn(`Failed to delete some forum threads during archive cleanup`, LogCategory.COMMAND_EXECUTION, {
      guildId,
      type,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return count;
}

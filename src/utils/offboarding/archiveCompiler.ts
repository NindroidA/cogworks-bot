/**
 * Archive Compiler
 *
 * Compiles all archived data (tickets, applications, memories, logs) into
 * a compressed JSON file for DM delivery before guild data purge.
 */

import { gzipSync } from 'node:zlib';
import { AppDataSource } from '../../typeorm';
import { AuditLog } from '../../typeorm/entities/AuditLog';
import { AnnouncementLog } from '../../typeorm/entities/announcement/AnnouncementLog';
import { ArchivedApplication } from '../../typeorm/entities/application/ArchivedApplication';
import { BaitChannelLog } from '../../typeorm/entities/bait/BaitChannelLog';
import { MemoryItem } from '../../typeorm/entities/memory/MemoryItem';
import { ArchivedTicket } from '../../typeorm/entities/ticket/ArchivedTicket';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';

export interface ArchiveStats {
  archivedTickets: number;
  archivedApplications: number;
  memoryItems: number;
  announcementLogs: number;
  auditLogs: number;
  baitLogs: number;
  totalEntries: number;
  compressedSizeBytes: number;
}

export interface CompiledArchive {
  buffer: Buffer;
  filename: string;
  stats: ArchiveStats;
}

/**
 * Compile all guild archive data into a compressed JSON file.
 */
export async function compileGuildArchive(guildId: string): Promise<CompiledArchive> {
  const [archivedTickets, archivedApplications, memoryItems, announcementLogs, auditLogs, baitLogs] = await Promise.all(
    [
      AppDataSource.getRepository(ArchivedTicket).find({ where: { guildId } }),
      AppDataSource.getRepository(ArchivedApplication).find({
        where: { guildId },
      }),
      AppDataSource.getRepository(MemoryItem).find({ where: { guildId } }),
      AppDataSource.getRepository(AnnouncementLog).find({ where: { guildId } }),
      AppDataSource.getRepository(AuditLog).find({ where: { guildId } }),
      AppDataSource.getRepository(BaitChannelLog).find({ where: { guildId } }),
    ],
  );

  const archive = {
    format: 'cogworks-archive-v1',
    metadata: {
      guildId,
      exportDate: new Date().toISOString(),
      version: '3.0.0',
      entryCount:
        archivedTickets.length +
        archivedApplications.length +
        memoryItems.length +
        announcementLogs.length +
        auditLogs.length +
        baitLogs.length,
    },
    archivedTickets,
    archivedApplications,
    memoryItems,
    announcementLogs,
    auditLogs,
    baitLogs,
  };

  const json = JSON.stringify(archive);
  const compressed = gzipSync(Buffer.from(json));

  const stats: ArchiveStats = {
    archivedTickets: archivedTickets.length,
    archivedApplications: archivedApplications.length,
    memoryItems: memoryItems.length,
    announcementLogs: announcementLogs.length,
    auditLogs: auditLogs.length,
    baitLogs: baitLogs.length,
    totalEntries: archive.metadata.entryCount,
    compressedSizeBytes: compressed.length,
  };

  enhancedLogger.info('Guild archive compiled', LogCategory.COMMAND_EXECUTION, {
    guildId,
    ...stats,
  });

  return {
    buffer: compressed,
    filename: `cogworks-archive-${guildId}-${Date.now()}.json.gz`,
    stats,
  };
}

/**
 * Archive Compiler
 *
 * Compiles all archived data (tickets, applications, memories, logs) into
 * a compressed JSON file for DM delivery before guild data purge.
 */

import { gzipSync } from 'node:zlib';
import type { EntityTarget, ObjectLiteral } from 'typeorm';
import { AppDataSource } from '../../typeorm';
import { AuditLog } from '../../typeorm/entities/AuditLog';
import { AnnouncementLog } from '../../typeorm/entities/announcement/AnnouncementLog';
import { ArchivedApplication } from '../../typeorm/entities/application/ArchivedApplication';
import { BaitChannelLog } from '../../typeorm/entities/bait/BaitChannelLog';
import { MemoryItem } from '../../typeorm/entities/memory/MemoryItem';
import { ArchivedTicket } from '../../typeorm/entities/ticket/ArchivedTicket';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';

interface CompileEntity {
  /** Output key in the compiled archive AND stats. */
  name: keyof ArchiveStats;
  entity: EntityTarget<ObjectLiteral>;
}

const COMPILE_ENTITIES: CompileEntity[] = [
  { name: 'archivedTickets', entity: ArchivedTicket },
  { name: 'archivedApplications', entity: ArchivedApplication },
  { name: 'memoryItems', entity: MemoryItem },
  { name: 'announcementLogs', entity: AnnouncementLog },
  { name: 'auditLogs', entity: AuditLog },
  { name: 'baitLogs', entity: BaitChannelLog },
];

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
  const collected = await Promise.all(
    COMPILE_ENTITIES.map(async ({ name, entity }) => {
      const rows = await AppDataSource.getRepository(entity).find({ where: { guildId } });
      return [name, rows] as const;
    }),
  );

  const data: Partial<Record<keyof ArchiveStats, unknown[]>> = Object.fromEntries(collected);
  const totalEntries = collected.reduce((sum, [, rows]) => sum + rows.length, 0);

  const archive = {
    format: 'cogworks-archive-v1',
    metadata: {
      guildId,
      exportDate: new Date().toISOString(),
      version: '3.0.0',
      entryCount: totalEntries,
    },
    ...data,
  };

  const json = JSON.stringify(archive);
  const compressed = gzipSync(Buffer.from(json));

  const stats: ArchiveStats = {
    archivedTickets: data.archivedTickets?.length ?? 0,
    archivedApplications: data.archivedApplications?.length ?? 0,
    memoryItems: data.memoryItems?.length ?? 0,
    announcementLogs: data.announcementLogs?.length ?? 0,
    auditLogs: data.auditLogs?.length ?? 0,
    baitLogs: data.baitLogs?.length ?? 0,
    totalEntries,
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

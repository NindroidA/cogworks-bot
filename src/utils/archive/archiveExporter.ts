/**
 * Archive Exporter
 *
 * Exports archived tickets or applications into a compressed JSON file in the
 * cogworks-archive-v2 format, including the transcript text read from each
 * row's forum thread (the only place a transcript lives), then deletes only
 * what the file actually covers: rows still pointing at the thread that was
 * read, whose thread got no new message since.
 */

import { gzipSync } from 'node:zlib';
import type { Client } from 'discord.js';
import { In, IsNull } from 'typeorm';
import { version } from '../../../package.json';
import { AppDataSource } from '../../typeorm';
import { ArchivedApplication } from '../../typeorm/entities/application/ArchivedApplication';
import { ArchivedTicket } from '../../typeorm/entities/ticket/ArchivedTicket';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import {
  captureTranscripts,
  deleteIfExported,
  type ExportCoverage,
  exportCoverage,
  TRANSCRIPT_EXPORT_NOTE,
} from './transcriptCapture';

export type ArchiveSystem = 'tickets' | 'applications' | 'all';

/** An exported row and the thread it pointed at then; the row is deleted only while it still points there. */
export interface ExportedRow {
  id: number;
  threadId: string | null;
}

/** What the export file covers, per table, plus what it saw of each thread. */
export interface ArchiveExportCoverage {
  tickets: ExportedRow[];
  applications: ExportedRow[];
  threads: ExportCoverage;
}

export interface ArchiveExportResult {
  buffer: Buffer;
  filename: string;
  entryCount: number;
  compressedSizeBytes: number;
  /** Rows safe to delete: exported, and their transcript is in the file (or their thread is already gone). */
  deletable: ArchiveExportCoverage;
  /** Threads that could not be read. They and their rows are kept. */
  unreadableCount: number;
}

interface ArchivedRow {
  id: number;
  messageId: string | null;
}

/**
 * Export archived data for a specific system into a compressed JSON file.
 */
export async function exportArchives(
  guildId: string,
  system: ArchiveSystem,
  client: Client,
): Promise<ArchiveExportResult> {
  const tickets: ArchivedTicket[] =
    system === 'applications' ? [] : await AppDataSource.getRepository(ArchivedTicket).find({ where: { guildId } });
  const apps: ArchivedApplication[] =
    system === 'tickets' ? [] : await AppDataSource.getRepository(ArchivedApplication).find({ where: { guildId } });
  const rows: ArchivedRow[] = [...tickets, ...apps];
  const totalEntries = rows.length;

  const capture = await captureTranscripts(
    client,
    guildId,
    rows.map(r => r.messageId).filter((id): id is string => !!id),
  );
  const unreadable = new Set(capture.unreadable);
  const deletableRows = (list: ArchivedRow[]): ExportedRow[] =>
    list.filter(r => !r.messageId || !unreadable.has(r.messageId)).map(r => ({ id: r.id, threadId: r.messageId }));

  const archive = {
    format: 'cogworks-archive-v2',
    metadata: {
      guildId,
      guildName: client.guilds.cache.get(guildId)?.name ?? null,
      exportDate: new Date().toISOString(),
      version,
      system,
      entryCount: totalEntries,
      transcriptCount: Object.keys(capture.transcripts).length,
      unreadableThreadIds: capture.unreadable,
      note: TRANSCRIPT_EXPORT_NOTE,
    },
    ...(system === 'applications' ? {} : { archivedTickets: tickets }),
    ...(system === 'tickets' ? {} : { archivedApplications: apps }),
    transcripts: capture.transcripts,
  };

  const compressed = gzipSync(Buffer.from(JSON.stringify(archive)));

  enhancedLogger.info(`Archive exported: ${system}`, LogCategory.COMMAND_EXECUTION, {
    guildId,
    system,
    entryCount: totalEntries,
    unreadableThreads: unreadable.size,
    compressedSizeBytes: compressed.length,
  });

  return {
    buffer: compressed,
    filename: `cogworks-archive-${system}-${guildId}-${Date.now()}.json.gz`,
    entryCount: totalEntries,
    compressedSizeBytes: compressed.length,
    deletable: {
      tickets: deletableRows(tickets),
      applications: deletableRows(apps),
      threads: exportCoverage(capture),
    },
    unreadableCount: unreadable.size,
  };
}

export interface ArchiveDeleteResult {
  deleted: number;
  threadsDeleted: number;
  /** Rows kept because their thread changed since the export (new message, new thread) or couldn't be deleted. */
  kept: number;
}

/**
 * Delete the exported archived rows and their forum threads: thread first, and
 * a row only once its thread is confirmed gone. Rows created after the export
 * are never in `exported`, and a row whose thread changed after the export (a
 * returning user's re-close appends to their existing thread, or re-creates a
 * missing one) is kept along with that thread.
 *
 * `progress` is updated after every row, so if a DB or Discord error stops the
 * cleanup part-way, the caller can still say what was deleted before it.
 */
export async function deleteArchivedEntries(
  guildId: string,
  exported: ArchiveExportCoverage,
  client: Client,
  progress: ArchiveDeleteResult = { deleted: 0, threadsDeleted: 0, kept: 0 },
): Promise<ArchiveDeleteResult> {
  await deleteRowsWithThreads(client, guildId, ArchivedTicket, exported.tickets, exported.threads, progress);
  await deleteRowsWithThreads(client, guildId, ArchivedApplication, exported.applications, exported.threads, progress);

  enhancedLogger.info('Archived entries deleted', LogCategory.COMMAND_EXECUTION, { guildId, ...progress });
  return progress;
}

async function deleteRowsWithThreads(
  client: Client,
  guildId: string,
  entity: typeof ArchivedTicket | typeof ArchivedApplication,
  exported: ExportedRow[],
  threads: ExportCoverage,
  progress: ArchiveDeleteResult,
): Promise<void> {
  if (exported.length === 0) return;
  const exportedThread = new Map(exported.map(r => [r.id, r.threadId]));
  const repo = AppDataSource.getRepository<ArchivedRow & { guildId: string }>(entity);
  const rows = await repo.find({ where: { guildId, id: In([...exportedThread.keys()]) } });

  for (const row of rows) {
    const threadId = row.messageId;
    if (threadId !== exportedThread.get(row.id)) {
      progress.kept++; // repointed to a thread the export never read
      continue;
    }
    if (threadId) {
      const outcome = await deleteIfExported(client, guildId, threads, threadId, 'archive thread');
      if (outcome === 'failed' || outcome === 'kept') {
        progress.kept++; // thread still holds content: keep its row
        continue;
      }
      if (outcome === 'deleted') progress.threadsDeleted++;
    }
    // Only while the row still points there: a close that found the thread gone may have just repointed it.
    const { affected } = await repo.delete({ guildId, id: row.id, messageId: threadId ?? IsNull() });
    if (affected) progress.deleted += affected;
    else progress.kept++;
  }
}

/**
 * Archive Compiler
 *
 * Compiles everything /bot-reset is about to delete into one compressed JSON
 * file for DM delivery: every guild-scoped DB row (the same list /data-export
 * uses) plus the text of every Discord thread/channel that holds content the
 * DB doesn't (archived ticket/application transcripts, memory threads, open
 * ticket/application channels).
 *
 * The tables sit at the top level, as in cogworks-archive-v1, so the
 * dashboard's Archive Viewer keeps reading them; `transcripts` is new.
 */

import { gzipSync } from 'node:zlib';
import type { Client } from 'discord.js';
import { version } from '../../../package.json';
import {
  type CaptureOptions,
  captureTranscripts,
  type ExportCoverage,
  exportCoverage,
  TRANSCRIPT_EXPORT_NOTE,
} from '../archive/transcriptCapture';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import { fetchAllExportData } from './guildDataExport';

export interface ArchiveStats {
  archivedTickets: number;
  archivedApplications: number;
  memoryItems: number;
  transcripts: number;
  totalEntries: number;
  compressedSizeBytes: number;
}

export interface CompiledArchive {
  buffer: Buffer;
  filename: string;
  stats: ArchiveStats;
  /** What the archive holds of each thread/channel: the reset deletes only these, and only while unchanged. */
  coverage: ExportCoverage;
}

type Row = Record<string, unknown>;

/** v1 names the Archive Viewer reads, where they differ from the /data-export table names. */
const V1_TABLE_NAMES: Record<string, string> = { baitChannelLogs: 'baitLogs' };

/** IDs of the Discord threads/channels whose messages exist nowhere else. */
export function transcriptChannelIds(data: Record<string, unknown[]>): string[] {
  const pick = (key: string, field: string, include: (row: Row) => boolean = () => true) =>
    ((data[key] ?? []) as Row[])
      .filter(include)
      .map(row => row[field])
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const open = (row: Row) => row.status !== 'closed';

  return [
    ...pick('archivedTickets', 'messageId'),
    ...pick('archivedApplications', 'messageId'),
    ...pick('memoryItems', 'threadId'),
    ...pick('tickets', 'channelId', open),
    ...pick('applications', 'channelId', open),
  ];
}

/**
 * Compile all guild data plus channel transcripts into a compressed JSON file.
 */
export async function compileGuildArchive(
  guildId: string,
  client: Client,
  options: CaptureOptions = {},
): Promise<CompiledArchive> {
  const data = await fetchAllExportData(guildId);
  const capture = await captureTranscripts(client, guildId, transcriptChannelIds(data), options);
  const totalEntries = Object.values(data).reduce((sum, rows) => sum + rows.length, 0);
  const transcriptCount = Object.keys(capture.transcripts).length;

  const archive = {
    format: 'cogworks-archive-v2',
    metadata: {
      guildId,
      guildName: client.guilds.cache.get(guildId)?.name ?? null,
      exportDate: new Date().toISOString(),
      version,
      entryCount: totalEntries,
      transcriptCount,
      unreadableChannelIds: capture.unreadable,
      note: TRANSCRIPT_EXPORT_NOTE,
    },
    ...Object.fromEntries(Object.entries(data).map(([name, rows]) => [V1_TABLE_NAMES[name] ?? name, rows])),
    transcripts: capture.transcripts,
  };

  const compressed = gzipSync(Buffer.from(JSON.stringify(archive)));

  const stats: ArchiveStats = {
    archivedTickets: data.archivedTickets?.length ?? 0,
    archivedApplications: data.archivedApplications?.length ?? 0,
    memoryItems: data.memoryItems?.length ?? 0,
    transcripts: transcriptCount,
    totalEntries,
    compressedSizeBytes: compressed.length,
  };

  enhancedLogger.info('Guild archive compiled', LogCategory.COMMAND_EXECUTION, {
    guildId,
    ...stats,
    unreadableChannels: capture.unreadable.length,
  });

  return {
    buffer: compressed,
    filename: `cogworks-archive-${guildId}-${Date.now()}.json.gz`,
    stats,
    coverage: exportCoverage(capture),
  };
}

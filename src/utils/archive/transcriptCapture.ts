/**
 * Transcript capture + guarded channel deletion for export-then-delete flows.
 *
 * Ticket/application transcripts (and memory discussions) live ONLY as
 * messages in Discord threads/channels; the DB rows hold just the IDs. Any
 * flow that deletes those threads (/bot-reset, /archive cleanup) must copy
 * their text into the export first, and must keep every thread it could not
 * read. Text only: attachments are listed by name + URL, but the files are not
 * downloaded, and those links stop working once the thread is deleted.
 *
 * Deletion is allow-listed: a flow deletes only what the export covers, and
 * only while it is unchanged (its newest message is still the one the export
 * saw). A thread that got a new message after it was read (a returning user's
 * re-close appends to their existing archive thread) or a channel created
 * after the export is kept.
 */

import type { Client, GuildBasedChannel, GuildTextBasedChannel } from 'discord.js';
import { verifiedChannelDelete } from '../discord/verifiedDelete';
import { fetchMessagesAsTranscript } from '../fetchAllMessages';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import type { TranscriptMessage } from '../ticket/transcriptBuilder';

/** Discord "Unknown Channel": the channel/thread is already gone. */
const UNKNOWN_CHANNEL = 10003;

/**
 * Stop reading this long after the command was run, so the 15-minute
 * interaction token outlives the deletion and the summary that follow.
 */
export const TRANSCRIPT_CAPTURE_BUDGET_MS = 8 * 60 * 1000;

export const TRANSCRIPT_EXPORT_NOTE =
  'Transcripts are text only. Attachment files are not included, and their links stop working once the Discord threads are deleted.';

export interface CapturedTranscript {
  channelId: string;
  name: string;
  /** Newest message when the channel was read (null: none). Deletion requires it to still be the newest. */
  lastMessageId: string | null;
  messages: TranscriptMessage[];
}

export interface TranscriptCaptureResult {
  /** channelId → transcript, for every channel read in full. */
  transcripts: Record<string, CapturedTranscript>;
  /** Already deleted in Discord (10003): nothing left to save. */
  missing: string[];
  /** Could not be read (permissions, network, time budget). Callers must NOT delete these. */
  unreadable: string[];
}

/** What an export covers: the channels it read (with their newest message then) and the ones already gone. */
export interface ExportCoverage {
  read: ReadonlyMap<string, string | null>;
  gone: ReadonlySet<string>;
}

export function exportCoverage(capture: TranscriptCaptureResult): ExportCoverage {
  return {
    read: new Map(Object.values(capture.transcripts).map(t => [t.channelId, t.lastMessageId])),
    gone: new Set(capture.missing),
  };
}

/** `kept`: deliberately not deleted, because the export doesn't hold its current content. */
export type DeleteOutcome = 'deleted' | 'gone' | 'failed' | 'kept';

export function discordErrorCode(error: unknown): unknown {
  const e = error as { code?: unknown; rawError?: { code?: unknown } } | null;
  return e?.code ?? e?.rawError?.code;
}

/** Fetch a guild channel/thread by ID. `'gone'` only for 10003; any other failure is `null` (unknown state). */
async function fetchGuildChannel(
  client: Client,
  guildId: string,
  channelId: string,
): Promise<GuildBasedChannel | 'gone' | null> {
  try {
    // force: the cached copy's lastMessageId can lag; the change check needs Discord's current value.
    const channel = await client.channels.fetch(channelId, { force: true });
    if (!channel || !('guildId' in channel) || channel.guildId !== guildId) return null;
    return channel as GuildBasedChannel;
  } catch (error) {
    return discordErrorCode(error) === UNKNOWN_CHANNEL ? 'gone' : null;
  }
}

function lastMessageIdOf(channel: GuildBasedChannel): string | null {
  return channel.isTextBased() ? (channel.lastMessageId ?? null) : null;
}

export interface CaptureOptions {
  /** Epoch ms after which no further channel is read (default: now + TRANSCRIPT_CAPTURE_BUDGET_MS). */
  deadline?: number;
  now?: () => number;
}

/** Read the full message history of each channel/thread. Sequential, until the deadline. */
export async function captureTranscripts(
  client: Client,
  guildId: string,
  channelIds: Iterable<string>,
  options: CaptureOptions = {},
): Promise<TranscriptCaptureResult> {
  const result: TranscriptCaptureResult = { transcripts: {}, missing: [], unreadable: [] };
  const now = options.now ?? Date.now;
  const deadline = options.deadline ?? now() + TRANSCRIPT_CAPTURE_BUDGET_MS;

  for (const channelId of new Set(channelIds)) {
    if (now() > deadline) {
      result.unreadable.push(channelId);
      continue;
    }
    const channel = await fetchGuildChannel(client, guildId, channelId);
    if (channel === 'gone') {
      result.missing.push(channelId);
      continue;
    }
    if (!channel?.isTextBased()) {
      result.unreadable.push(channelId);
      continue;
    }
    try {
      // Noted before reading, so a message posted mid-read changes it and the channel is kept.
      const lastMessageId = lastMessageIdOf(channel);
      const messages = await fetchMessagesAsTranscript(channel as GuildTextBasedChannel, client.user?.id ?? '');
      result.transcripts[channelId] = { channelId, name: channel.name, lastMessageId, messages };
    } catch (error) {
      enhancedLogger.warn('Could not read a channel transcript; it will be kept', LogCategory.COMMAND_EXECUTION, {
        guildId,
        channelId,
        error: error instanceof Error ? error.message : String(error),
      });
      result.unreadable.push(channelId);
    }
  }

  return result;
}

/**
 * Delete a channel or thread by ID. `'gone'` when it no longer exists,
 * `'failed'` when it may still exist (callers keep its DB row). With
 * `expectedLastMessageId`, a channel whose newest message differs is `'kept'`.
 */
export async function deleteChannelById(
  client: Client,
  guildId: string,
  channelId: string,
  label: string,
  expectedLastMessageId?: string | null,
): Promise<DeleteOutcome> {
  const channel = await fetchGuildChannel(client, guildId, channelId);
  if (channel === 'gone') return 'gone';
  if (!channel) return 'failed';
  if (expectedLastMessageId !== undefined && lastMessageIdOf(channel) !== expectedLastMessageId) return 'kept';
  const result = await verifiedChannelDelete(channel, { guildId, label });
  if (!result.success) return 'failed';
  return result.alreadyGone ? 'gone' : 'deleted';
}

/**
 * Delete a channel/thread only if the export holds all of it: it was read, and
 * its newest message is still the one read. Anything else is `'kept'`.
 */
export async function deleteIfExported(
  client: Client,
  guildId: string,
  coverage: ExportCoverage,
  channelId: string,
  label: string,
): Promise<DeleteOutcome> {
  if (coverage.gone.has(channelId)) return 'gone';
  const lastMessageId = coverage.read.get(channelId);
  if (lastMessageId === undefined) return 'kept'; // unreadable, or created after the export
  return deleteChannelById(client, guildId, channelId, label, lastMessageId);
}

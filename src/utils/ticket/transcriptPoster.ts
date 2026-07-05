/**
 * Posts a built transcript into a forum archive thread.
 *
 * Shared spine of the ticket and application close workflows (near-mirror
 * archive paths). Kept separate from the pure `transcriptBuilder` so that
 * module stays Discord-client-free.
 *
 * Attachments are DOWNLOADED and RE-UPLOADED here (v3.14.0): the original
 * CDN links are signed URLs that expire — and the source channel is deleted
 * right after archiving — so re-hosting the files on the archive thread is
 * the only way pictures/videos stay viewable. Failure ladder, in order:
 *   1. files are sent in aggregate-size-capped batches so one send never
 *      exceeds the guild upload budget;
 *   2. a batch Discord still rejects (40005/50035/413) is demoted to
 *      per-file sends, so one oversized payload can't sink its neighbors;
 *   3. a single file Discord rejects falls back to the masked CDN link
 *      already present in the chunk text;
 *   4. any NON-rejection error (permissions, network) rethrows so the caller
 *      marks the archive failed and preserves the source channel for retry —
 *      swallowing those would silently lose the files forever.
 * Never pings (historical content) and attributes a failed send to its chunk
 * index so a partial-archive failure is diagnosable.
 */
import {
  AttachmentBuilder,
  type ColorResolvable,
  EmbedBuilder,
  type ForumThreadChannel,
  type MessageCreateOptions,
} from 'discord.js';
import { MAX, TIMEOUTS } from '../constants';
import { enhancedLogger, LogCategory } from '../monitoring/enhancedLogger';
import type { TranscriptAttachment, TranscriptChunk, TranscriptHeaderData } from './transcriptBuilder';

export interface TranscriptPostContext {
  guildId: string;
  channelId: string;
  /** Log-label prefix for chunk-failure errors. Defaults to 'Transcript'. */
  label?: string;
}

/** Turns the builder's pure header data into the archive post's embed card. */
export function buildHeaderEmbed(data: TranscriptHeaderData, color: ColorResolvable): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(data.title)
    .setColor(color)
    .addFields(data.fields.map(f => ({ name: f.name, value: f.value, inline: f.inline })));
}

/** Injectable download seam so tests never hit the network. */
export interface TranscriptPosterDeps {
  download: (attachment: TranscriptAttachment) => Promise<Buffer | null>;
}

/**
 * Fetch an attachment's bytes for re-upload. Returns null (link-only
 * fallback) when the file is over the re-upload cap, the fetch fails, or the
 * CDN stalls past the timeout — the chunk text already carries a masked link
 * for exactly that case. The cap is enforced three times: declared size,
 * Content-Length header, and the actual buffer, so a lying header can't make
 * us hold an arbitrarily large body in memory.
 */
export async function downloadAttachment(attachment: TranscriptAttachment): Promise<Buffer | null> {
  if (attachment.size !== undefined && attachment.size > MAX.TRANSCRIPT_REUPLOAD_BYTES) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUTS.TRANSCRIPT_DOWNLOAD);
  try {
    const res = await fetch(attachment.url, { signal: controller.signal });
    if (!res.ok) return null;
    const contentLength = Number(res.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX.TRANSCRIPT_REUPLOAD_BYTES) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return buffer.byteLength <= MAX.TRANSCRIPT_REUPLOAD_BYTES ? buffer : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const defaultDeps: TranscriptPosterDeps = { download: downloadAttachment };

interface DownloadedFile {
  name: string;
  buffer: Buffer;
}

/**
 * True when Discord rejected the payload itself (too large / invalid form) —
 * the only failures where retrying without (some) files makes sense. Anything
 * else (permissions, rate limit, network) must propagate to the archive-retry
 * path instead of silently dropping files.
 */
export function isUploadRejection(error: unknown): boolean {
  const code = (error as { code?: number | string })?.code;
  if (code === 40005 || code === 50035) return true;
  const status = (error as { status?: number })?.status;
  return status === 413;
}

/**
 * Greedy, order-preserving batching so no single send's aggregate file size
 * exceeds `budget`. Discord enforces a total-request cap separate from the
 * per-file limit — ten individually-fine files can still sink one send.
 */
export function batchBySize(
  files: DownloadedFile[],
  budget: number = MAX.TRANSCRIPT_REUPLOAD_BYTES,
): DownloadedFile[][] {
  const batches: DownloadedFile[][] = [];
  let current: DownloadedFile[] = [];
  let currentBytes = 0;
  for (const file of files) {
    if (current.length > 0 && currentBytes + file.buffer.byteLength > budget) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(file);
    currentBytes += file.buffer.byteLength;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

const toBuilders = (files: DownloadedFile[]) => files.map(f => new AttachmentBuilder(f.buffer, { name: f.name }));

export async function postTranscriptToThread(
  thread: ForumThreadChannel,
  chunks: TranscriptChunk[],
  ctx: TranscriptPostContext,
  deps: TranscriptPosterDeps = defaultDeps,
): Promise<void> {
  const label = ctx.label ?? 'Transcript';
  const noPing: MessageCreateOptions['allowedMentions'] = { parse: [] };

  /** Per-file rescue: send each alone; a rejected single file keeps its link fallback. */
  const sendPerFile = async (files: DownloadedFile[]): Promise<void> => {
    for (const file of files) {
      try {
        await thread.send({ files: toBuilders([file]), allowedMentions: noPing });
      } catch (error) {
        if (!isUploadRejection(error)) throw error;
        enhancedLogger.warn(`${label} attachment rejected by Discord — link fallback stands`, LogCategory.SYSTEM, {
          guildId: ctx.guildId,
          channelId: ctx.channelId,
          attachment: file.name,
        });
      }
    }
  };

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    try {
      const downloaded: DownloadedFile[] = [];
      for (const attachment of chunk.files) {
        const buffer = await deps.download(attachment);
        if (buffer) {
          downloaded.push({ name: attachment.name, buffer });
        } else {
          // Masked link in the chunk text is the fallback copy.
          enhancedLogger.warn(`${label} attachment not re-uploaded (too large or fetch failed)`, LogCategory.SYSTEM, {
            guildId: ctx.guildId,
            channelId: ctx.channelId,
            attachment: attachment.name,
          });
        }
      }
      const batches = batchBySize(downloaded);

      // Text (+ first file batch) — the text itself must always land.
      const payload: MessageCreateOptions = { content: chunk.content, allowedMentions: noPing };
      if (batches.length === 0) {
        await thread.send(payload);
      } else {
        try {
          await thread.send({ ...payload, files: toBuilders(batches[0]) });
        } catch (error) {
          if (!isUploadRejection(error)) throw error;
          // Batch rejected despite the size budget (e.g. stricter guild cap):
          // land the text, then rescue the files one by one.
          await thread.send(payload);
          await sendPerFile(batches[0]);
        }
      }

      // Overflow batches ride as follow-up file-only sends.
      for (const batch of batches.slice(1)) {
        try {
          await thread.send({ files: toBuilders(batch), allowedMentions: noPing });
        } catch (error) {
          if (!isUploadRejection(error)) throw error;
          await sendPerFile(batch);
        }
      }
    } catch (error) {
      enhancedLogger.error(
        `${label} chunk ${i + 1}/${chunks.length} failed to post`,
        error as Error,
        LogCategory.SYSTEM,
        { guildId: ctx.guildId, channelId: ctx.channelId },
      );
      throw error;
    }
  }
}

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
 * the only way pictures/videos stay viewable. Failures degrade gracefully:
 * an oversized or undownloadable file falls back to the masked link already
 * present in the chunk text; a send that Discord rejects for its payload is
 * retried without files. Never pings (historical content), attributes a
 * failed send to its chunk index so a partial-archive failure is diagnosable,
 * and rethrows so the caller marks the archive failed.
 */
import {
  AttachmentBuilder,
  type ColorResolvable,
  EmbedBuilder,
  type ForumThreadChannel,
  type MessageCreateOptions,
} from 'discord.js';
import { MAX } from '../constants';
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
 * fallback) when the file is over the re-upload cap or the fetch fails —
 * the chunk text already carries a masked link for exactly that case.
 */
async function downloadAttachment(attachment: TranscriptAttachment): Promise<Buffer | null> {
  if (attachment.size !== undefined && attachment.size > MAX.TRANSCRIPT_REUPLOAD_BYTES) return null;
  try {
    const res = await fetch(attachment.url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

const defaultDeps: TranscriptPosterDeps = { download: downloadAttachment };

export async function postTranscriptToThread(
  thread: ForumThreadChannel,
  chunks: TranscriptChunk[],
  ctx: TranscriptPostContext,
  deps: TranscriptPosterDeps = defaultDeps,
): Promise<void> {
  const label = ctx.label ?? 'Transcript';
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    const files: AttachmentBuilder[] = [];
    if (chunk.files.length > 0) {
      const buffers = await Promise.all(chunk.files.map(f => deps.download(f)));
      for (let j = 0; j < chunk.files.length; j++) {
        const buffer = buffers[j];
        if (buffer) {
          files.push(new AttachmentBuilder(buffer, { name: chunk.files[j].name }));
        } else {
          // Masked link in the chunk text is the fallback copy.
          enhancedLogger.warn(`${label} attachment not re-uploaded (too large or fetch failed)`, LogCategory.SYSTEM, {
            guildId: ctx.guildId,
            channelId: ctx.channelId,
            attachment: chunk.files[j].name,
          });
        }
      }
    }

    const payload: MessageCreateOptions = { content: chunk.content, allowedMentions: { parse: [] } };
    try {
      if (files.length > 0) {
        try {
          await thread.send({ ...payload, files });
          continue;
        } catch (error) {
          // Payload rejected (e.g. over the guild's upload limit) — the text
          // with its fallback links still must land, so retry without files.
          enhancedLogger.warn(
            `${label} chunk ${i + 1}/${chunks.length} file upload failed — sending text only`,
            LogCategory.SYSTEM,
            {
              guildId: ctx.guildId,
              channelId: ctx.channelId,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }
      }
      await thread.send(payload);
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

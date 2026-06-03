/**
 * Pure transcript builder. Takes a shape-checked `TranscriptMessage[]`
 * plus metadata and produces a markdown header + chunked follow-up
 * messages sized to fit inside Discord's 2000-char message limit.
 *
 * No Discord client or I/O — all Discord-touching concerns stay in the
 * fetcher layer. That separation is what makes this testable without a
 * gateway connection.
 *
 * Fidelity contract (v3.2.1): the transcript is an exact carbon copy of the
 * conversation. Message content is NEVER truncated — a message longer than a
 * single Discord post is split across multiple chunks on line boundaries (the
 * pre-v3.2.1 builder hard-truncated at 500 chars and silently dropped the
 * tail). Stickers, polls, and embed media are captured too.
 */

import { TEXT_LIMITS } from '../constants';

/** Per-message shape the fetcher hands to the builder. */
export interface TranscriptMessage {
  author: { username: string; id: string; bot: boolean };
  content: string;
  timestamp: Date;
  attachments: TranscriptAttachment[];
  embeds: TranscriptEmbed[];
  stickers: TranscriptSticker[];
  poll: TranscriptPoll | null;
  replyTo?: { author: string; content: string };
  isSystem: boolean;
  hasOnlyComponents: boolean;
}

export interface TranscriptAttachment {
  name: string;
  url: string;
  contentType?: string;
}

export interface TranscriptEmbed {
  title?: string;
  description?: string;
  url?: string;
  author?: string;
  footer?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  color?: number;
  fields?: { name: string; value: string }[];
}

export interface TranscriptSticker {
  name: string;
  url: string;
}

export interface TranscriptPoll {
  question: string;
  answers: { text: string; voteCount: number }[];
}

/** Ticket-level metadata rendered into the header. */
export interface TicketMetadata {
  title: string;
  type: string;
  createdByUsername: string;
  openedAt: Date;
  closedAt: Date;
  assignedToUsername: string | null;
}

export interface TranscriptResult {
  header: string;
  chunks: string[];
  messageCount: number;
  attachmentCount: number;
}

/** Soft cap — the packing target, with headroom under the hard limit. */
const CHUNK_SOFT_LIMIT = TEXT_LIMITS.TRANSCRIPT_CHUNK_SOFT;
/** Discord's hard per-message limit. No emitted chunk may exceed this. */
const CHUNK_HARD_LIMIT = TEXT_LIMITS.TRANSCRIPT_CHUNK_HARD;

/** `<t:unix:f>` — Discord renders this in the viewer's local timezone. */
function formatDiscordTimestamp(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:f>`;
}

/** Minutes-granularity duration for `2h 14m` / `3d 5h` / `47m` strings. */
export function formatDurationShort(ms: number): string {
  if (ms < 60_000) return '<1m';
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

/** Prefix every line with `> ` so the whole block becomes a Discord blockquote. */
function blockquote(body: string): string {
  return body
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n');
}

export function formatHeader(metadata: TicketMetadata, messageCount: number, attachmentCount: number): string {
  const duration = formatDurationShort(metadata.closedAt.getTime() - metadata.openedAt.getTime());
  const lines = [
    `# 🎫 Ticket: ${metadata.title}`,
    '',
    `**Created by:** ${metadata.createdByUsername}`,
    `**Opened:** ${formatDiscordTimestamp(metadata.openedAt)}`,
    `**Closed:** ${formatDiscordTimestamp(metadata.closedAt)}`,
    `**Duration:** ${duration}`,
    `**Type:** ${metadata.type}`,
    `**Assigned to:** ${metadata.assignedToUsername ?? 'Unassigned'}`,
    `**Messages:** ${messageCount}`,
  ];
  if (attachmentCount > 0) lines.push(`**Attachments:** ${attachmentCount}`);
  lines.push('', '---');
  return lines.join('\n');
}

function formatAttachment(a: TranscriptAttachment): string {
  if (!a.url) return `> 📎 ~~${a.name}~~ (unavailable)`;
  return `> 📎 [${a.name}](${a.url})`;
}

function formatSticker(s: TranscriptSticker): string {
  if (!s.url) return `> 🏷️ Sticker: ${s.name}`;
  return `> 🏷️ Sticker: [${s.name}](${s.url})`;
}

function formatPoll(poll: TranscriptPoll): string[] {
  const lines = [`> 📊 **Poll:** ${poll.question}`];
  for (const answer of poll.answers) {
    const votes = `${answer.voteCount} vote${answer.voteCount === 1 ? '' : 's'}`;
    lines.push(`> • ${answer.text} — ${votes}`);
  }
  return lines;
}

function formatEmbedBody(embed: TranscriptEmbed): string[] {
  const parts: string[] = [];
  if (embed.author) parts.push(`*${embed.author}*`);
  if (embed.title) parts.push(embed.url ? `**[${embed.title}](${embed.url})**` : `**${embed.title}**`);
  if (embed.description) parts.push(embed.description);
  if (embed.fields && embed.fields.length > 0) {
    for (const field of embed.fields) {
      parts.push(`*${field.name}:* ${field.value}`);
    }
  }
  if (embed.imageUrl) parts.push(`🖼️ [image](${embed.imageUrl})`);
  if (embed.thumbnailUrl) parts.push(`🖼️ [thumbnail](${embed.thumbnailUrl})`);
  if (embed.footer) parts.push(`— ${embed.footer}`);
  if (parts.length === 0) return [];
  // Indent the whole embed one level deeper than the message blockquote.
  return blockquote(parts.join('\n'))
    .split('\n')
    .map(line => `> ${line}`);
}

export function formatMessage(msg: TranscriptMessage): string {
  const header = msg.replyTo
    ? `**${msg.author.username}** ${formatDiscordTimestamp(msg.timestamp)}  ↩️ *replying to ${msg.replyTo.author}*`
    : `**${msg.author.username}** ${formatDiscordTimestamp(msg.timestamp)}`;

  const bodyLines: string[] = [];

  // Full content — never truncated. Oversized messages are split across
  // chunks by chunkByMessageBoundary so nothing is ever lost.
  if (msg.content) {
    bodyLines.push(blockquote(msg.content));
  }

  for (const embed of msg.embeds) {
    bodyLines.push(...formatEmbedBody(embed));
  }

  for (const sticker of msg.stickers) {
    bodyLines.push(formatSticker(sticker));
  }

  if (msg.poll) {
    bodyLines.push(...formatPoll(msg.poll));
  }

  for (const attachment of msg.attachments) {
    bodyLines.push(formatAttachment(attachment));
  }

  if (bodyLines.length === 0) {
    // Message filtered from body content but kept because something referenced it
    // (edge case: a reply chain anchor with empty body).
    bodyLines.push('> *(no content)*');
  }

  return [header, ...bodyLines].join('\n');
}

/** Hard-slice a string into ≤`limit` segments. Last resort — never drops content. */
function hardSlice(text: string, limit: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += limit) {
    out.push(text.slice(i, i + limit));
  }
  return out;
}

/** Leading run of `> ` blockquote markers (handles nesting, e.g. `> > `). */
const QUOTE_PREFIX_RE = /^((?:> )+)/;

/**
 * Split one formatted message that exceeds `limit` into ≤`limit` pieces on line
 * boundaries. When a split lands inside a fenced code block the open fence is
 * closed on the current piece and reopened on the next — at the SAME blockquote
 * depth the fence was opened — so each resulting Discord message renders as
 * valid markdown. A single line longer than `limit` is hard-sliced on its
 * content while preserving its `> ` prefix on every segment, so continuation
 * pieces stay blockquoted. Content is never dropped.
 */
function splitFormattedMessage(message: string, limit: number): string[] {
  const pieces: string[] = [];
  let buf: string[] = [];
  let bufLen = 0;
  let inFence = false;
  // The blockquote depth the active fence was opened at — close/reopen must
  // match it (a fence inside an embed body is double-quoted: `> > ```).
  let fencePrefix = '> ';
  const fenceLine = () => `${fencePrefix}\`\`\``;

  const flush = (willContinue: boolean) => {
    if (buf.length > 0) {
      let body = buf.join('\n');
      if (inFence) body += `\n${fenceLine()}`; // close the open fence cleanly
      pieces.push(body);
      buf = [];
      bufLen = 0;
    }
    if (willContinue && inFence) {
      const fl = fenceLine(); // reopen the fence on the next piece
      buf = [fl];
      bufLen = fl.length;
    }
  };

  const addLine = (line: string) => {
    const addLen = (bufLen ? 1 : 0) + line.length;
    if (bufLen && bufLen + addLen > limit) flush(true);
    buf.push(line);
    bufLen += bufLen ? 1 + line.length : line.length;
  };

  for (const line of message.split('\n')) {
    const prefix = line.match(QUOTE_PREFIX_RE)?.[1] ?? '';
    const content = line.slice(prefix.length);

    if (line.length > limit) {
      // Pathological single line (a long URL / base64 blob with no newline).
      // Hard-slice the CONTENT and re-apply the quote prefix to every segment so
      // continuation pieces stay blockquoted; reserve headroom for a fence
      // close/reopen wrapper so every emitted piece stays ≤ limit. A fence
      // marker is short and never lands here, so fence state is unaffected.
      const reserve = fenceLine().length + 1;
      const segLimit = Math.max(1, limit - prefix.length - reserve);
      for (const seg of hardSlice(content, segLimit)) {
        addLine(prefix + seg);
      }
      continue;
    }

    addLine(line);
    if (content.trimStart().startsWith('```')) {
      inFence = !inFence;
      if (inFence) fencePrefix = prefix; // remember the depth for close/reopen
    }
  }
  flush(false);
  return pieces;
}

/**
 * Pack already-formatted messages into chunks, each guaranteed ≤ `hardLimit`
 * characters, never dropping content. Whole messages stay together when they
 * fit; a single message larger than `softLimit` is split on line boundaries
 * (see {@link splitFormattedMessage}). A final defensive pass hard-slices any
 * chunk still over `hardLimit` — silent loss here is the exact failure mode the
 * carbon-copy fix exists to prevent.
 */
export function chunkByMessageBoundary(
  formattedMessages: string[],
  softLimit: number = CHUNK_SOFT_LIMIT,
  hardLimit: number = CHUNK_HARD_LIMIT,
): string[] {
  const chunks: string[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer) {
      chunks.push(buffer);
      buffer = '';
    }
  };

  for (const message of formattedMessages) {
    const pieces = message.length <= softLimit ? [message] : splitFormattedMessage(message, softLimit);
    for (const piece of pieces) {
      if (buffer && buffer.length + 2 + piece.length > softLimit) flush();
      buffer = buffer ? `${buffer}\n\n${piece}` : piece;
    }
  }
  flush();

  return chunks.flatMap(chunk => (chunk.length <= hardLimit ? [chunk] : hardSlice(chunk, hardLimit)));
}

function shouldIncludeMessage(msg: TranscriptMessage): boolean {
  if (msg.isSystem) return false;
  if (msg.hasOnlyComponents) return false;
  const hasText = msg.content.trim().length > 0;
  const hasAttachments = msg.attachments.length > 0;
  const hasStickers = msg.stickers.length > 0;
  const hasPoll = msg.poll !== null;
  // Keep any embed the renderer (formatEmbedBody) would produce visible output
  // for — including author/footer-only embeds — so nothing the carbon copy can
  // render is silently filtered out.
  const hasMeaningfulEmbeds = msg.embeds.some(
    e =>
      e.title ||
      e.description ||
      e.author ||
      e.footer ||
      e.imageUrl ||
      e.thumbnailUrl ||
      (e.fields && e.fields.length > 0),
  );
  return hasText || hasAttachments || hasStickers || hasPoll || hasMeaningfulEmbeds;
}

/**
 * End-to-end builder. Filters out system/UI noise, formats survivors,
 * and chunks them to fit Discord's per-message limit.
 */
export function buildTranscript(messages: TranscriptMessage[], metadata: TicketMetadata): TranscriptResult {
  const kept = messages.filter(shouldIncludeMessage);
  const attachmentCount = kept.reduce((sum, m) => sum + m.attachments.length, 0);
  const header = formatHeader(metadata, kept.length, attachmentCount);

  if (kept.length === 0) {
    const hadAny = messages.length > 0;
    return {
      header,
      chunks: [hadAny ? '*(No human messages)*' : '*(No messages)*'],
      messageCount: 0,
      attachmentCount: 0,
    };
  }

  const formatted = kept.map(formatMessage);
  const chunks = chunkByMessageBoundary(formatted);

  return {
    header,
    chunks,
    messageCount: kept.length,
    attachmentCount,
  };
}

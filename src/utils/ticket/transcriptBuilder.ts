/**
 * Pure transcript builder. Takes a shape-checked `TranscriptMessage[]`
 * plus metadata and produces embed-header data + chunked follow-up
 * messages sized to fit inside Discord's 2000-char message limit.
 *
 * No Discord client or I/O — all Discord-touching concerns stay in the
 * fetcher/poster layers. That separation is what makes this testable without
 * a gateway connection.
 *
 * Fidelity contract (v3.2.1): the transcript is an exact carbon copy of the
 * conversation. Message content is NEVER truncated — a message longer than a
 * single Discord post is split across multiple chunks on line boundaries (the
 * pre-v3.2.1 builder hard-truncated at 500 chars and silently dropped the
 * tail). Stickers, polls, and embed media are captured too.
 *
 * Readability contract (v3.14.0): archive posts read like a real Discord
 * conversation — day dividers, short time-only timestamps, consecutive
 * messages from one author grouped under a single name line, plain (unquoted)
 * bodies. Only foreign-embed content stays blockquoted, so bot output is
 * visually distinct from what people actually said. Attachments ride on their
 * chunk as re-uploadable payloads (`TranscriptChunk.files`) so the poster can
 * attach the real files — CDN links die when the source channel is deleted.
 */

import { TEXT_LIMITS } from '../constants';
import { toUnixSeconds } from '../time';

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
  /** Byte size from Discord — lets the poster skip re-uploads over the limit. */
  size?: number;
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

/** Ticket-level metadata rendered into the header embed. */
export interface TicketMetadata {
  title: string;
  type: string;
  createdByUsername: string;
  openedAt: Date;
  closedAt: Date;
  assignedToUsername: string | null;
  /** Picks the header emoji + field set. Defaults to 'ticket'. */
  kind?: 'ticket' | 'application';
  /** Discord user id of the opener — badges their author lines with 👤. */
  createdById?: string;
  /** Discord user id of the assignee — badges their author lines with 🛡️. */
  assignedToId?: string;
}

/** Author-line badge context, derived from {@link TicketMetadata}. */
export interface AuthorBadges {
  createdById?: string;
  assignedToId?: string;
}

/** Pure header-embed data — the poster turns this into an EmbedBuilder. */
export interface TranscriptHeaderData {
  title: string;
  fields: { name: string; value: string; inline: boolean }[];
}

/** One postable archive message: text plus the files to re-upload with it. */
export interface TranscriptChunk {
  content: string;
  files: TranscriptAttachment[];
}

export interface TranscriptResult {
  headerData: TranscriptHeaderData;
  chunks: TranscriptChunk[];
  messageCount: number;
  attachmentCount: number;
}

/** Soft cap — the packing target, with headroom under the hard limit. */
const CHUNK_SOFT_LIMIT = TEXT_LIMITS.TRANSCRIPT_CHUNK_SOFT;
/** Discord's hard per-message limit. No emitted chunk may exceed this. */
const CHUNK_HARD_LIMIT = TEXT_LIMITS.TRANSCRIPT_CHUNK_HARD;
/** Discord's hard per-message attachment limit. */
const MAX_FILES_PER_MESSAGE = 10;
/**
 * Messages from the same author within this window collapse under one name
 * line — mirrors Discord's own message-grouping behavior.
 */
const GROUP_WINDOW_MS = 7 * 60_000;

/** `<t:unix:t>` — short time-only stamp; the day divider carries the date. */
function formatTimeStamp(date: Date): string {
  return `<t:${toUnixSeconds(date)}:t>`;
}

/** `<t:unix:f>` — full date+time, used in the header embed fields. */
function formatFullStamp(date: Date): string {
  return `<t:${toUnixSeconds(date)}:f>`;
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

/**
 * Header data for the archive post's embed card. Applications omit the
 * "Assigned to" row when there's no assignee (tickets show "Unassigned" —
 * unassigned tickets are signal, unassigned applications are the norm).
 */
export function buildHeaderData(
  metadata: TicketMetadata,
  messageCount: number,
  attachmentCount: number,
): TranscriptHeaderData {
  const kind = metadata.kind ?? 'ticket';
  const duration = formatDurationShort(metadata.closedAt.getTime() - metadata.openedAt.getTime());
  const fields: TranscriptHeaderData['fields'] = [
    { name: 'Opened', value: formatFullStamp(metadata.openedAt), inline: true },
    { name: 'Closed', value: formatFullStamp(metadata.closedAt), inline: true },
    { name: 'Duration', value: duration, inline: true },
    { name: 'Type', value: metadata.type, inline: true },
    { name: 'Created by', value: metadata.createdByUsername, inline: true },
  ];
  if (metadata.assignedToUsername !== null || kind === 'ticket') {
    fields.push({ name: 'Assigned to', value: metadata.assignedToUsername ?? 'Unassigned', inline: true });
  }
  const counts = attachmentCount > 0 ? `${messageCount} · ${attachmentCount} 📎` : `${messageCount}`;
  fields.push({ name: 'Messages', value: counts, inline: true });
  // Discord caps embed titles at 256 chars — an email-ticket subject can
  // exceed that, and an over-limit title fails the whole archive post.
  const title = `${kind === 'application' ? '📋' : '🎫'} ${metadata.title}`;
  return {
    title: title.length > 256 ? `${title.slice(0, 255)}…` : title,
    fields,
  };
}

function formatAttachment(a: TranscriptAttachment): string {
  if (!a.url) return `📎 ~~${a.name}~~ (unavailable)`;
  // <url> suppresses Discord's link preview — the re-uploaded file on the
  // same chunk is the visible copy; the link is the fallback if that fails.
  return `📎 [${a.name}](<${a.url}>)`;
}

function formatSticker(s: TranscriptSticker): string {
  if (!s.url) return `🏷️ Sticker: ${s.name}`;
  return `🏷️ Sticker: [${s.name}](${s.url})`;
}

function formatPoll(poll: TranscriptPoll): string[] {
  const lines = [`📊 **Poll:** ${poll.question}`];
  for (const answer of poll.answers) {
    const votes = `${answer.voteCount} vote${answer.voteCount === 1 ? '' : 's'}`;
    lines.push(`• ${answer.text} — ${votes}`);
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
  // Blockquote the embed so foreign-bot output stays visually distinct from
  // the plain-bodied human conversation around it.
  return blockquote(parts.join('\n')).split('\n');
}

/** Body lines only — used for both fresh messages and grouped continuations. */
function formatMessageBody(msg: TranscriptMessage): string {
  const bodyLines: string[] = [];

  // Full content — never truncated. Oversized messages are split across
  // chunks by the chunker so nothing is ever lost.
  if (msg.content) {
    bodyLines.push(msg.content);
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
    // Message filtered from body content but kept because something referenced
    // it (edge case: a reply chain anchor with empty body).
    bodyLines.push('*(no content)*');
  }

  return bodyLines.join('\n');
}

/** 🤖 bots, 👤 the ticket opener, 🛡️ the assignee — no badge for anyone else. */
function authorBadge(msg: TranscriptMessage, badges?: AuthorBadges): string {
  if (msg.author.bot) return '🤖 ';
  if (badges?.createdById && msg.author.id === badges.createdById) return '👤 ';
  if (badges?.assignedToId && msg.author.id === badges.assignedToId) return '🛡️ ';
  return '';
}

/**
 * Reply marker with a short context snippet — the full original message is
 * elsewhere in the transcript, so the snippet trims markdown and truncates.
 */
function formatReplyMarker(replyTo: NonNullable<TranscriptMessage['replyTo']>): string {
  const clean = replyTo.content
    .replace(/[*_`|~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return `↳ *to ${replyTo.author}*`;
  const snippet = clean.length > 60 ? `${clean.slice(0, 59)}…` : clean;
  return `↳ *to ${replyTo.author}: "${snippet}"*`;
}

export function formatMessage(msg: TranscriptMessage, badges?: AuthorBadges): string {
  const stamp = `${authorBadge(msg, badges)}**${msg.author.username}** · ${formatTimeStamp(msg.timestamp)}`;
  const header = msg.replyTo ? `${stamp}  ${formatReplyMarker(msg.replyTo)}` : stamp;
  return `${header}\n${formatMessageBody(msg)}`;
}

/** UTC calendar-day key for divider bucketing. */
function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `-# ── Wednesday, April 1, 2026 ──` — small grey subtext divider (UTC). */
function formatDayDivider(date: Date): string {
  const label = date.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  return `-# ── ${label} ──`;
}

/** One packable unit: a formatted message (or author-group) plus its files. */
interface TranscriptUnit {
  text: string;
  files: TranscriptAttachment[];
}

/**
 * Format kept messages into units: day dividers are prepended to the first
 * message of each UTC day, and consecutive messages from the same author
 * within {@link GROUP_WINDOW_MS} merge under one name line. A message that
 * carries attachments ends its unit so the chunker can pin the files directly
 * beneath its text.
 */
function buildUnits(kept: TranscriptMessage[], badges?: AuthorBadges): TranscriptUnit[] {
  const units: TranscriptUnit[] = [];
  let prev: TranscriptMessage | null = null;

  for (const msg of kept) {
    const uploadable = msg.attachments.filter(a => a.url);
    const newDay = !prev || utcDayKey(prev.timestamp) !== utcDayKey(msg.timestamp);
    const canGroup =
      prev !== null &&
      !newDay &&
      prev.author.id === msg.author.id &&
      !msg.replyTo &&
      prev.attachments.length === 0 &&
      msg.timestamp.getTime() - prev.timestamp.getTime() <= GROUP_WINDOW_MS;

    if (canGroup) {
      const unit = units[units.length - 1];
      unit.text += `\n${formatMessageBody(msg)}`;
      unit.files.push(...uploadable);
    } else {
      const divider = newDay ? `${formatDayDivider(msg.timestamp)}\n` : '';
      units.push({ text: divider + formatMessage(msg, badges), files: [...uploadable] });
    }
    prev = msg;
  }

  return units;
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
 * content while preserving any `> ` prefix on every segment, so continuation
 * pieces stay blockquoted. Content is never dropped.
 */
function splitFormattedMessage(message: string, limit: number): string[] {
  const pieces: string[] = [];
  let buf: string[] = [];
  let bufLen = 0;
  let inFence = false;
  // The blockquote depth the active fence was opened at — close/reopen must
  // match it (a fence inside an embed body is quoted: `> ```).
  let fencePrefix = '';
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
      // Hard-slice the CONTENT and re-apply any quote prefix to every segment
      // so continuation pieces stay blockquoted; reserve headroom for a fence
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

/** Split files into ≤10-per-message batches (Discord's attachment cap). */
function batchFiles(files: TranscriptAttachment[]): TranscriptAttachment[][] {
  const batches: TranscriptAttachment[][] = [];
  for (let i = 0; i < files.length; i += MAX_FILES_PER_MESSAGE) {
    batches.push(files.slice(i, i + MAX_FILES_PER_MESSAGE));
  }
  return batches;
}

/**
 * Pack formatted units into chunks, each guaranteed ≤ `hardLimit` characters
 * and ≤ 10 files, never dropping content. Whole units stay together when they
 * fit; a single unit larger than `softLimit` is split on line boundaries (see
 * {@link splitFormattedMessage}). A unit with files forces a flush right after
 * its text so the re-uploaded attachments render directly beneath the message
 * they belong to. A final defensive pass hard-slices any chunk still over
 * `hardLimit` — silent loss here is the exact failure mode the carbon-copy fix
 * exists to prevent.
 */
function chunkUnits(units: TranscriptUnit[], softLimit: number, hardLimit: number): TranscriptChunk[] {
  const chunks: TranscriptChunk[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer) {
      chunks.push({ content: buffer, files: [] });
      buffer = '';
    }
  };

  for (const unit of units) {
    const pieces = unit.text.length <= softLimit ? [unit.text] : splitFormattedMessage(unit.text, softLimit);
    for (const piece of pieces) {
      if (buffer && buffer.length + 2 + piece.length > softLimit) flush();
      buffer = buffer ? `${buffer}\n\n${piece}` : piece;
    }
    if (unit.files.length > 0) {
      // Pin files under their message: flush the text, attach the first batch
      // to it, and overflow extra batches into marker-only follow-up chunks.
      flush();
      const batches = batchFiles(unit.files);
      chunks[chunks.length - 1].files = batches[0];
      for (let b = 1; b < batches.length; b++) {
        chunks.push({ content: '-# 📎 (continued)', files: batches[b] });
      }
    }
  }
  flush();

  return chunks.flatMap(chunk => {
    if (chunk.content.length <= hardLimit) return [chunk];
    const slices = hardSlice(chunk.content, hardLimit);
    return slices.map((content, i) => ({
      content,
      files: i === slices.length - 1 ? chunk.files : [],
    }));
  });
}

/**
 * Pack already-formatted text messages into ≤`hardLimit` strings. Text-only
 * spine of {@link chunkUnits}, kept for callers that chunk plain markdown
 * (e.g. ticket-create answer posts).
 */
export function chunkByMessageBoundary(
  formattedMessages: string[],
  softLimit: number = CHUNK_SOFT_LIMIT,
  hardLimit: number = CHUNK_HARD_LIMIT,
): string[] {
  return chunkUnits(
    formattedMessages.map(text => ({ text, files: [] })),
    softLimit,
    hardLimit,
  ).map(chunk => chunk.content);
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
 * End-to-end builder. Filters out system/UI noise, formats survivors
 * chat-style, and chunks them (text + attachment payloads) to fit Discord's
 * per-message limits.
 */
export function buildTranscript(messages: TranscriptMessage[], metadata: TicketMetadata): TranscriptResult {
  const kept = messages.filter(shouldIncludeMessage);
  const attachmentCount = kept.reduce((sum, m) => sum + m.attachments.length, 0);
  const headerData = buildHeaderData(metadata, kept.length, attachmentCount);

  if (kept.length === 0) {
    const hadAny = messages.length > 0;
    return {
      headerData,
      chunks: [{ content: hadAny ? '*(No human messages)*' : '*(No messages)*', files: [] }],
      messageCount: 0,
      attachmentCount: 0,
    };
  }

  const units = buildUnits(kept, { createdById: metadata.createdById, assignedToId: metadata.assignedToId });
  const chunks = chunkUnits(units, CHUNK_SOFT_LIMIT, CHUNK_HARD_LIMIT);

  return {
    headerData,
    chunks,
    messageCount: kept.length,
    attachmentCount,
  };
}

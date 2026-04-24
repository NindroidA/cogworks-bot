/**
 * Pure transcript builder. Takes a shape-checked `TranscriptMessage[]`
 * plus metadata and produces a markdown header + chunked follow-up
 * messages sized to fit inside Discord's 2000-char message limit.
 *
 * No Discord client or I/O — all Discord-touching concerns stay in the
 * fetcher layer. That separation is what makes this testable without a
 * gateway connection.
 */

/** Per-message shape the fetcher hands to the builder. */
export interface TranscriptMessage {
  author: { username: string; id: string; bot: boolean };
  content: string;
  timestamp: Date;
  attachments: TranscriptAttachment[];
  embeds: TranscriptEmbed[];
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
  fields?: { name: string; value: string }[];
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

/** Soft cap — Discord's hard limit is 2000 per message. */
const CHUNK_SOFT_LIMIT = 1900;
/** When a single formatted message exceeds this, truncate inline. */
const LONG_MESSAGE_LIMIT = 500;

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

export function truncateLongMessage(content: string, limit: number = LONG_MESSAGE_LIMIT): string {
  if (content.length <= limit) return content;
  return `${content.slice(0, limit)}… (truncated)`;
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

function formatEmbedBody(embed: TranscriptEmbed): string[] {
  const parts: string[] = [];
  if (embed.title) parts.push(`**${embed.title}**`);
  if (embed.description) parts.push(embed.description);
  if (embed.fields && embed.fields.length > 0) {
    for (const field of embed.fields) {
      parts.push(`*${field.name}:* ${field.value}`);
    }
  }
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

  if (msg.content) {
    const content = truncateLongMessage(msg.content);
    bodyLines.push(blockquote(content));
  }

  for (const embed of msg.embeds) {
    bodyLines.push(...formatEmbedBody(embed));
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

/**
 * Split a list of already-formatted messages into chunks each ≤ `limit`
 * characters, never splitting mid-message. A single message that on its
 * own exceeds `limit` is kept intact — the caller should have already run
 * `truncateLongMessage` on it via `formatMessage`.
 */
export function chunkByMessageBoundary(formattedMessages: string[], limit: number = CHUNK_SOFT_LIMIT): string[] {
  const chunks: string[] = [];
  let buffer = '';
  for (const message of formattedMessages) {
    if (buffer && buffer.length + 2 + message.length > limit) {
      chunks.push(buffer);
      buffer = '';
    }
    buffer = buffer ? `${buffer}\n\n${message}` : message;
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}

function shouldIncludeMessage(msg: TranscriptMessage): boolean {
  if (msg.isSystem) return false;
  if (msg.hasOnlyComponents) return false;
  const hasText = msg.content.trim().length > 0;
  const hasAttachments = msg.attachments.length > 0;
  const hasMeaningfulEmbeds = msg.embeds.some(e => e.title || e.description || (e.fields && e.fields.length > 0));
  return hasText || hasAttachments || hasMeaningfulEmbeds;
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

import type { GuildTextBasedChannel, Message } from 'discord.js';
import type { TranscriptMessage } from './ticket/transcriptBuilder';

/**
 * Fetch every message in `channel` and map them into the pure
 * `TranscriptMessage` shape the builder consumes.
 *
 * `botClientId` is used to classify the bot's own component-only messages
 * (ticket buttons, close dialogs) so the builder can filter them out.
 * Without it, every Cogworks UI message would appear in the archive as
 * empty-bodied noise.
 */
export async function fetchMessagesAsTranscript(
  channel: GuildTextBasedChannel,
  botClientId: string,
): Promise<TranscriptMessage[]> {
  if (!channel) {
    throw new Error('Invalid channel or channel is not a text channel.');
  }

  const raw: Message[] = [];
  let lastId: string | undefined;

  // Batch of 100 is Discord's max per request.
  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, before: lastId });
    if (batch.size === 0) break;
    raw.push(...Array.from(batch.values()));
    lastId = batch.last()?.id;
  }

  // Reverse: channel.messages.fetch returns newest-first; transcript reads oldest-first.
  raw.reverse();

  // Cache referenced messages for reply resolution. In most tickets the
  // reply target is already inside the fetched window, so a lookup map
  // avoids an extra API call.
  const byId = new Map<string, Message>(raw.map(m => [m.id, m]));

  return raw.map(m => toTranscriptMessage(m, byId, botClientId));
}

function toTranscriptMessage(m: Message, byId: Map<string, Message>, botClientId: string): TranscriptMessage {
  const replyId = m.reference?.messageId;
  const replyTarget = replyId ? byId.get(replyId) : undefined;

  return {
    author: {
      username: m.author.username,
      id: m.author.id,
      bot: m.author.bot,
    },
    // cleanContent resolves <@id>/<@&id>/<#id> mentions to readable @name/#name
    // text (no raw mention syntax) so the archived transcript shows names, not
    // pings. Combined with allowedMentions:{parse:[]} on the forum send, the
    // archive can never notify anyone.
    content: m.cleanContent ?? m.content ?? '',
    timestamp: m.createdAt,
    attachments: Array.from(m.attachments.values()).map(a => ({
      name: a.name,
      url: a.url,
      contentType: a.contentType ?? undefined,
    })),
    embeds: m.embeds.map(e => ({
      title: e.title ?? undefined,
      description: e.description ?? undefined,
      url: e.url ?? undefined,
      author: e.author?.name ?? undefined,
      footer: e.footer?.text ?? undefined,
      imageUrl: e.image?.url ?? undefined,
      thumbnailUrl: e.thumbnail?.url ?? undefined,
      color: e.color ?? undefined,
      fields: e.fields?.map(f => ({ name: f.name, value: f.value })),
    })),
    stickers: Array.from(m.stickers.values()).map(s => ({
      name: s.name,
      url: s.url,
    })),
    poll: m.poll
      ? {
          question: m.poll.question.text ?? '',
          answers: Array.from(m.poll.answers.values()).map(a => ({
            text: a.text ?? '',
            voteCount: a.voteCount,
          })),
        }
      : null,
    replyTo: replyTarget
      ? {
          author: replyTarget.author.username,
          content: replyTarget.cleanContent ?? replyTarget.content ?? '',
        }
      : undefined,
    isSystem: m.system === true,
    hasOnlyComponents:
      m.author.id === botClientId &&
      !m.content &&
      m.embeds.length === 0 &&
      m.attachments.size === 0 &&
      m.components.length > 0,
  };
}

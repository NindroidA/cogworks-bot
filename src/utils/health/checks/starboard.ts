/**
 * Starboard health check (design inventory §3.6). Only an enabled starboard is
 * checked; channelDelete disables it and blanks the channel when the channel goes.
 */
import { rowsOf } from '../context';
import { defineCheck, type FindingTarget } from '../define';
import type { HealthCheck } from '../types';
import {
  type ChannelRule,
  channelFindings,
  channelNames,
  channelPermissionFindings,
  EMBED_SEND,
  MESSAGE_KINDS,
  prunableRefs,
} from './featureRefs';

/**
 * One unicode emoji, loosely: a regional indicator or flag, a keycap, or a pictograph with optional
 * variation selector, skin tone and tag characters, joined by ZWJ. Accepts every RGI emoji (validateEmoji
 * rejects flags, skin tones and keycaps, #131) plus the lone regional indicators bots react with.
 */
const EMOJI_PART =
  /(?:\p{Regional_Indicator}{1,2}|[0-9#*]\uFE0F?\u20E3|[\p{Extended_Pictographic}\p{Emoji_Modifier}][\uFE0E\uFE0F\p{Emoji_Modifier}\u{E0020}-\u{E007F}]*)/u
    .source;
const UNICODE_EMOJI = new RegExp(`^${EMOJI_PART}(?:\\u200D${EMOJI_PART})*$`, 'u');

/**
 * Whether a reaction can ever match the stored emoji. The handler compares it with the reaction's
 * name (the unicode emoji, or a custom emoji's name) and its `<:name:id>` form. Only custom-emoji
 * syntax is checked strictly; a bare word can still name a custom emoji (the emoji cache may be stale).
 */
function canMatchReaction(emoji: string): boolean {
  if (emoji.startsWith('<')) return /^<a?:\w{2,32}:\d{17,20}>$/.test(emoji);
  return /^\w{2,32}$/.test(emoji) || UNICODE_EMOJI.test(emoji);
}

const config = defineCheck(
  {
    id: 'starboard.config',
    system: 'starboard',
    entities: ['StarboardConfig'],
    names: [
      'channel_unset',
      ...channelNames('channel'),
      'channel_history',
      'emoji_invalid',
      'threshold_invalid',
      'ignored_channel_missing',
    ],
    isConfigured: ctx => rowsOf(ctx, 'StarboardConfig')[0]?.enabled === true,
  },
  (ctx, emit) => {
    const row = rowsOf(ctx, 'StarboardConfig')[0];
    if (!row?.enabled) return [];
    const at = (field: string, params = {}): FindingTarget => ({
      entity: 'StarboardConfig',
      rowId: row.id,
      field,
      params,
    });
    // New posts are embeds sent to the channel. Updating an existing post's count fetches it first, which
    // needs Read Message History; that failure is swallowed, and new posts still go out without it.
    const post: ChannelRule = { kinds: MESSAGE_KINDS, perms: EMBED_SEND, severity: 'block' };
    const history: ChannelRule = { ...post, perms: ['ReadMessageHistory'], severity: 'degraded' };
    const out = row.channelId
      ? [
          ...channelFindings(ctx, emit, 'channel', row.channelId, at('channelId'), post),
          ...channelPermissionFindings(ctx, emit, 'channel_history', row.channelId, at('channelId'), history),
        ]
      : [emit('channel_unset', 'block', 'manual', at('channelId'))];
    const emoji = String(row.emoji ?? '');
    if (!canMatchReaction(emoji)) out.push(emit('emoji_invalid', 'block', 'manual', at('emoji', { emoji })));
    // Below 1, the first matching reaction posts the message.
    if (!(row.threshold >= 1))
      out.push(emit('threshold_invalid', 'degraded', 'confirm', at('threshold', { threshold: String(row.threshold) })));
    out.push(
      ...prunableRefs(ctx, emit, 'ignored_channel_missing', 'channel', row.ignoredChannels, at('ignoredChannels')),
    );
    return out;
  },
);

export const STARBOARD_CHECKS: readonly HealthCheck[] = [config];

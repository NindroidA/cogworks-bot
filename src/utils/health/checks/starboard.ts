/**
 * Starboard health check (design inventory §3.6). Only an enabled starboard is
 * checked; channelDelete disables it and blanks the channel when the channel goes.
 */
import { validateEmoji } from '../../validation/validators';
import { rowsOf } from '../context';
import { defineCheck, type FindingTarget } from '../define';
import type { HealthCheck } from '../types';
import { channelFindings, channelNames, EMBED_SEND, MESSAGE_KINDS, prunableRefs } from './featureRefs';

const config = defineCheck(
  {
    id: 'starboard.config',
    system: 'starboard',
    entities: ['StarboardConfig'],
    names: [
      'channel_unset',
      ...channelNames('channel'),
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
    // Posts are embeds, and updating a post's count fetches it from the channel.
    const rule = { kinds: MESSAGE_KINDS, perms: [...EMBED_SEND, 'ReadMessageHistory'], severity: 'block' } as const;
    const out = row.channelId
      ? channelFindings(ctx, emit, 'channel', row.channelId, at('channelId'), rule)
      : [emit('channel_unset', 'block', 'manual', at('channelId'))];
    // The handler compares the stored text with the reaction's name or `<:name:id>`. A bare word can
    // still match a custom emoji's name (and the emoji cache may be stale), so only the rest is flagged.
    const emoji = String(row.emoji ?? '');
    if (!validateEmoji(emoji).valid && !/^\w{2,32}$/.test(emoji))
      out.push(emit('emoji_invalid', 'block', 'manual', at('emoji', { emoji })));
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

/**
 * Reference helpers shared by the moderation checks: a configured channel's
 * type and the bot's permissions in it, whether the bot can hand out a role,
 * and deep-mode lookups of messages and threads through the REST budget.
 */
import type { CheckContext } from '../context';
import {
  type ChannelKind,
  channelIsKind,
  missingPermissions,
  type PermissionName,
  type RefStatus,
  resolveChannel,
  resolveRole,
} from '../refs';
import type { HealthSeverity } from '../types';

/**
 * Channels a posted message (rules, reaction-role menu) can live in. The slash commands only
 * offer text channels, but the dashboard accepts any channel with a text chat, and a text
 * channel converted to an announcement channel keeps working.
 */
export const MESSAGE_CHANNEL: readonly ChannelKind[] = ['text', 'news', 'voice', 'stage'];

/** Reaction features: without these the bot never sees a reaction on an uncached message (any, after a restart). */
export const REACTION_CRITICAL: readonly PermissionName[] = ['ViewChannel', 'ReadMessageHistory'];

/**
 * Emoji code points only, with at least one pictograph, flag letter or keycap, so a bare digit,
 * `#` or `*` (emoji components on their own) is text. Looser than `validateEmoji` (flags and
 * skin tones work in Discord), so it only flags text.
 */
export const UNICODE_EMOJI =
  /^(?=.*[\p{Extended_Pictographic}\p{Regional_Indicator}\u20E3])[\p{Extended_Pictographic}\p{Emoji_Component}]+$/u;

export type ChannelProblem =
  | { problem: 'missing' | 'wrong_type' }
  | { problem: 'permissions'; missing: PermissionName[] };

/**
 * What is wrong with a configured channel, or null when it is usable or can't
 * be judged (guild cache unavailable). Without the bot member the permissions
 * are skipped: the runner reports that once instead of every channel failing.
 */
export function channelProblem(
  ctx: CheckContext,
  id: string,
  kinds: readonly ChannelKind[],
  perms: readonly PermissionName[],
): ChannelProblem | null {
  const resolved = resolveChannel(ctx.guild, id);
  if (resolved.status !== 'ok') return resolved.status === 'missing' ? { problem: 'missing' } : null;
  if (!channelIsKind(resolved.value, ...kinds)) return { problem: 'wrong_type' };
  const missing = ctx.me ? missingPermissions(ctx.me, perms, resolved.value) : [];
  return missing.length > 0 ? { problem: 'permissions', missing } : null;
}

/** Lang params for a channel finding: the channel, plus the missing permissions when that is the problem. */
export function channelParams(id: string, found: ChannelProblem): Record<string, string> {
  return found.problem === 'permissions' ? { channelId: id, permissions: found.missing.join(', ') } : { channelId: id };
}

/** `block` when the channel is gone, the wrong type or lacks a `critical` permission; otherwise `degraded`. */
export function channelSeverity(found: ChannelProblem, critical: readonly PermissionName[]): HealthSeverity {
  if (found.problem !== 'permissions') return 'block';
  return found.missing.some(name => critical.includes(name)) ? 'block' : 'degraded';
}

/**
 * Whether the bot can still read a channel with this problem (none, or only non-critical
 * permissions missing), so its message or post is still worth looking up: a deleted message
 * must not hide behind a missing Add Reactions.
 */
export function channelReadable(found: ChannelProblem | null, critical: readonly PermissionName[]): boolean {
  return !found || channelSeverity(found, critical) === 'degraded';
}

/**
 * Why the bot can't hand out a saved role, or null when it can (or that can't
 * be proven): `validateRoleForMenu`'s rules (`reactionRole/menuBuilder.ts`)
 * as codes instead of localized messages, plus a deleted role.
 */
export function roleProblem(ctx: CheckContext, id: string): 'missing' | 'everyone' | 'managed' | 'too_high' | null {
  const resolved = resolveRole(ctx.guild, id);
  if (resolved.status !== 'ok') return resolved.status === 'missing' ? 'missing' : null;
  const role = resolved.value;
  if (role.id === ctx.guildId) return 'everyone';
  if (role.managed) return 'managed';
  if (ctx.me && role.position >= ctx.me.roles.highest.position) return 'too_high';
  return null;
}

/** Deep mode only: whether a message still exists. Null when not looked up. */
export async function messageStatus(
  ctx: CheckContext,
  label: string,
  channelId: string,
  messageId: string | null,
): Promise<RefStatus | 'skipped' | null> {
  const resolved = ctx.deep && messageId ? resolveChannel(ctx.guild, channelId) : null;
  if (resolved?.status !== 'ok' || !('messages' in resolved.value) || !messageId) return null;
  const { messages } = resolved.value;
  return (await ctx.rest.fetch(label, () => messages.fetch({ message: messageId, cache: false }))).status;
}

/** Whether a thread still exists. Active threads are cached; others are only looked up in deep mode (else `unknown`). */
export async function threadStatus(ctx: CheckContext, label: string, id: string): Promise<RefStatus | 'skipped'> {
  const cached = resolveChannel(ctx.guild, id, { mayBeThread: true });
  if (cached.status === 'ok' || !ctx.deep) return cached.status;
  return (await ctx.rest.fetch(label, () => ctx.guild.channels.fetch(id, { cache: false }))).status;
}

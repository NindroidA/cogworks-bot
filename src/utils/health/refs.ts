/**
 * Discord reference resolution for health checks.
 *
 * Repairs may only act on `missing` (proof the object is gone). `inaccessible`
 * (the bot can't see it) and `unknown` (5xx, 429, timeout, guild outage) never
 * justify a cleanup. Lookups are guild-scoped: never `client.channels.fetch`.
 * Caches are read with Map methods only so tests can pass plain Maps.
 */
import {
  ChannelType,
  type Guild,
  type GuildBasedChannel,
  type GuildMember,
  PermissionFlagsBits,
  type Role,
} from 'discord.js';
import { isValidSnowflake } from '../api/helpers';

export type RefStatus = 'ok' | 'missing' | 'inaccessible' | 'unknown';
export type Resolved<T> = { status: 'ok'; value: T } | { status: Exclude<RefStatus, 'ok'> };

/** Unknown Channel / Message / Role / User / Emoji. */
const MISSING_CODES = new Set([10003, 10008, 10011, 10013, 10014]);
/** Missing Access / Missing Permissions. */
const INACCESSIBLE_CODES = new Set([50001, 50013]);

export function classifyRestError(error: unknown): Exclude<RefStatus, 'ok'> {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (typeof code !== 'number') return 'unknown';
  if (MISSING_CODES.has(code)) return 'missing';
  if (INACCESSIBLE_CODES.has(code)) return 'inaccessible';
  return 'unknown';
}

function fromCache<T>(guild: Guild, cache: ReadonlyMap<string, T>, id: string): Resolved<T> {
  // The Guilds intent fills the role and non-thread channel caches completely, so
  // absence is proof, except while the guild is unavailable and the cache may be partial.
  if (!guild.available) return { status: 'unknown' };
  const value = cache.get(id);
  return value ? { status: 'ok', value } : { status: 'missing' };
}

export function resolveRole(guild: Guild, id: string): Resolved<Role> {
  return fromCache<Role>(guild, guild.roles.cache, id);
}

/**
 * Archived threads and forum posts are never cached, so a cache miss only proves
 * a non-thread channel is gone. Pass `mayBeThread` for an id that could be a
 * thread: a miss then reads `unknown`, and the check must confirm it via `ctx.rest`.
 */
export function resolveChannel(
  guild: Guild,
  id: string,
  opts: { mayBeThread?: boolean } = {},
): Resolved<GuildBasedChannel> {
  const resolved = fromCache<GuildBasedChannel>(guild, guild.channels.cache, id);
  return resolved.status === 'missing' && opts.mayBeThread ? { status: 'unknown' } : resolved;
}

export type ChannelKind = 'text' | 'news' | 'forum' | 'category' | 'voice' | 'stage';

const KIND_TYPES: Record<ChannelKind, ChannelType> = {
  text: ChannelType.GuildText,
  news: ChannelType.GuildAnnouncement,
  forum: ChannelType.GuildForum,
  category: ChannelType.GuildCategory,
  voice: ChannelType.GuildVoice,
  stage: ChannelType.GuildStageVoice,
};

export function channelIsKind(channel: { type: ChannelType }, ...kinds: ChannelKind[]): boolean {
  return kinds.some(kind => KIND_TYPES[kind] === channel.type);
}

export type PermissionName = keyof typeof PermissionFlagsBits;

/**
 * The `required` permissions the bot lacks in `channel`, or guild-wide when no
 * channel is given. Administrator satisfies everything. Without a bot member
 * every permission counts as missing; callers check `ctx.me` first.
 */
export function missingPermissions(
  me: GuildMember | null,
  required: readonly PermissionName[],
  channel?: GuildBasedChannel,
): PermissionName[] {
  const granted = me ? (channel ? channel.permissionsFor(me) : me.permissions) : null;
  return required.filter(name => !granted?.has(PermissionFlagsBits[name]));
}

/**
 * Role references were stored as the mention `<@&id>` before v3 and as the raw
 * snowflake since (the canonical format). Returns null for anything else.
 */
export function parseRoleRef(value: string | null | undefined): { id: string; legacy: boolean } | null {
  if (!value) return null;
  if (isValidSnowflake(value)) return { id: value, legacy: false };
  const match = /^<@&(\d{17,20})>$/.exec(value);
  return match ? { id: match[1], legacy: true } : null;
}

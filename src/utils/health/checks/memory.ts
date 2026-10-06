/**
 * Memory health checks (design inventory §3.6): each memory forum, its
 * welcome post, tags that left the forum or have an unknown type, stale
 * duplicate tag rows, and tags and items whose memory channel is gone.
 * Threads that aren't cached (archived ones) are only looked up in deep mode,
 * after the other checks' lookups, since a deleted post is only cosmetic.
 */
import type { GuildBasedChannel } from 'discord.js';
import type { MemoryTag } from '../../../typeorm/entities/memory';
import { type CheckContext, rowsOf } from '../context';
import { defineCheck, type FindingTarget } from '../define';
import { type PermissionName, resolveChannel } from '../refs';
import type { HealthCheck, HealthFinding } from '../types';
import { channelParams, channelProblem, channelReadable, channelSeverity, threadStatus } from './refHelpers';

const FORUM_PERMS: PermissionName[] = [
  'ViewChannel',
  'SendMessages',
  'SendMessagesInThreads',
  'ManageChannels',
  'ManageThreads',
];
/** Creating a post needs these; the rest cover tags, status changes and closing. */
const FORUM_CRITICAL: PermissionName[] = ['ViewChannel', 'SendMessages'];
/** Looking a post up only needs this; without it the lookup can only come back inaccessible. */
const FORUM_READ: PermissionName[] = ['ViewChannel'];
/** Deep mode looks up at most this many memory posts (a third of the REST budget); the rest are not checked. */
const POST_LOOKUPS = 20;

const isConfigured = (ctx: CheckContext) => rowsOf(ctx, 'MemoryConfig').length > 0;

/** Each config's forum by config id: the channel, or null when it doesn't resolve. */
function liveForums(ctx: CheckContext): Map<number, GuildBasedChannel | null> {
  const forums = new Map<number, GuildBasedChannel | null>();
  for (const config of rowsOf(ctx, 'MemoryConfig')) {
    const resolved = resolveChannel(ctx.guild, config.forumChannelId);
    forums.set(config.id, resolved.status === 'ok' ? resolved.value : null);
  }
  return forums;
}

const forums = defineCheck(
  {
    id: 'memory.forum',
    system: 'memory',
    entities: ['MemoryConfig'],
    isConfigured,
    names: ['missing', 'wrong_type', 'permissions', 'duplicate', 'welcome_missing'],
    restPriority: 'low',
  },
  async (ctx, emit) => {
    const out: HealthFinding[] = [];
    const kept = new Map<string, { id: number; name: string }>();
    for (const row of [...rowsOf(ctx, 'MemoryConfig')].sort((a, b) => a.id - b.id)) {
      const id = row.forumChannelId;
      const at: FindingTarget = { entity: 'MemoryConfig', rowId: row.id, field: 'forumChannelId', refId: id };
      const name = { name: row.channelName };
      const first = kept.get(id);
      if (first) {
        // The channel picker lists the forum twice, and commands run in its posts use one config
        // (`resolveConfigFromThread` has no ORDER BY; in practice the oldest row). Either can hold live memories,
        // and removing one deletes its memories, tags and welcome post: the admin decides.
        const params = { ...name, channelId: id, keptRowId: first.id, keptName: first.name };
        out.push(emit('duplicate', 'cosmetic', 'manual', { ...at, params }));
        continue;
      }
      kept.set(id, { id: row.id, name: row.channelName });
      const problem = channelProblem(ctx, id, ['forum'], FORUM_PERMS);
      if (problem) {
        const params = { ...name, ...channelParams(id, problem) };
        const repair = problem.problem === 'missing' ? 'auto' : 'manual';
        out.push(emit(problem.problem, channelSeverity(problem, FORUM_CRITICAL), repair, { ...at, params }));
      }
      const readable = channelReadable(problem, FORUM_READ);
      if (readable && row.messageId && (await threadStatus(ctx, 'memory.welcome', row.messageId)) === 'missing') {
        const params = { ...name, channelId: id };
        out.push(
          emit('welcome_missing', 'cosmetic', 'confirm', { ...at, field: 'messageId', refId: row.messageId, params }),
        );
      }
    }
    return out;
  },
);

const TAG_TYPES = new Set(['category', 'status']);

const tags = defineCheck(
  {
    id: 'memory.tag',
    system: 'memory',
    entities: ['MemoryConfig', 'MemoryTag'],
    isConfigured,
    names: ['orphan', 'invalid_type', 'not_in_forum', 'duplicate'],
  },
  (ctx, emit) => {
    const forumsById = liveForums(ctx);
    const rows = rowsOf(ctx, 'MemoryTag');
    const onForum = (tag: MemoryTag) => {
      const forum = forumsById.get(tag.memoryConfigId);
      return !!forum && 'availableTags' in forum && forum.availableTags.some(t => t.id === tag.discordTagId);
    };
    const nameKey = (tag: MemoryTag) => `${tag.memoryConfigId}:${tag.name.toLowerCase()}`;
    // Per memory channel and tag name, the oldest row that is on the forum.
    const linked = new Map<string, number>();
    for (const tag of [...rows].sort((a, b) => a.id - b.id))
      if (!linked.has(nameKey(tag)) && onForum(tag)) linked.set(nameKey(tag), tag.id);

    const out: HealthFinding[] = [];
    for (const tag of rows) {
      const at: FindingTarget = { entity: 'MemoryTag', rowId: tag.id, params: { name: tag.name } };
      if (!forumsById.has(tag.memoryConfigId)) {
        out.push(emit('orphan', 'cosmetic', 'auto', { ...at, field: 'memoryConfigId' }));
        continue;
      }
      // Every tag lookup asks for one type, so a tag of any other type is never offered.
      if (!TAG_TYPES.has(tag.tagType)) {
        const params = { ...at.params, tagType: String(tag.tagType) };
        out.push(emit('invalid_type', 'cosmetic', 'manual', { ...at, field: 'tagType', params }));
      }
      // A gone or wrong-type forum is reported once by memory.forum.
      const forum = forumsById.get(tag.memoryConfigId);
      if (!forum || !('availableTags' in forum) || onForum(tag)) continue;
      // Posts can't carry a tag the forum doesn't have, so memories with this category or status lose it.
      const target = { ...at, field: 'discordTagId', ...(tag.discordTagId ? { refId: tag.discordTagId } : {}) };
      const keptRowId = linked.get(nameKey(tag));
      // A copy left by setup re-runs before #55. A re-run keeps the linked row and leaves this one,
      // so it is a row to remove, not a tag to add back (that would name two forum tags alike).
      if (keptRowId !== undefined)
        out.push(emit('duplicate', 'degraded', 'confirm', { ...target, params: { ...at.params, keptRowId } }));
      else out.push(emit('not_in_forum', 'degraded', 'confirm', target));
    }
    return out;
  },
);

const items = defineCheck(
  {
    id: 'memory.item',
    system: 'memory',
    entities: ['MemoryConfig', 'MemoryItem'],
    isConfigured,
    names: ['orphan', 'thread_missing'],
    restPriority: 'low',
  },
  async (ctx, emit) => {
    const forumsById = liveForums(ctx);
    // Posts are only looked up in a forum the bot can see. A gone forum took its posts with it;
    // memory.forum reports a gone, wrong-type or hidden forum once.
    const readable = new Set<number>();
    for (const [configId, forum] of forumsById)
      if (forum && !channelProblem(ctx, forum.id, ['forum'], FORUM_READ)) readable.add(configId);
    const out: HealthFinding[] = [];
    for (const item of rowsOf(ctx, 'MemoryItem')) {
      const at: FindingTarget = { entity: 'MemoryItem', rowId: item.id, params: { title: item.title } };
      if (!forumsById.has(item.memoryConfigId)) {
        out.push(emit('orphan', 'cosmetic', 'auto', { ...at, field: 'memoryConfigId' }));
        continue;
      }
      if (!readable.has(item.memoryConfigId)) continue;
      // Over the cap or the budget, the fetcher lists the label as not checked.
      const status = await threadStatus(ctx, 'memory.thread', item.threadId, { maxCalls: POST_LOOKUPS });
      if (status === 'missing')
        out.push(emit('thread_missing', 'cosmetic', 'auto', { ...at, field: 'threadId', refId: item.threadId }));
    }
    return out;
  },
);

export const MEMORY_CHECKS: readonly HealthCheck[] = [forums, tags, items];

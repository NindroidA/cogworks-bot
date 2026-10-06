/**
 * Memory health checks (design inventory §3.6): each memory forum, its
 * welcome post, tags that left the forum, and tags and items whose memory
 * channel is gone. Threads that aren't cached (archived ones) are only looked
 * up in deep mode.
 */
import type { GuildBasedChannel } from 'discord.js';
import { type CheckContext, rowsOf } from '../context';
import { defineCheck, type FindingTarget } from '../define';
import { type PermissionName, resolveChannel } from '../refs';
import type { HealthCheck, HealthFinding } from '../types';
import { channelParams, channelProblem, channelSeverity, threadStatus } from './refHelpers';

const FORUM_PERMS: PermissionName[] = [
  'ViewChannel',
  'SendMessages',
  'SendMessagesInThreads',
  'ManageChannels',
  'ManageThreads',
];
/** Creating a post needs these; the rest cover tags, status changes and closing. */
const FORUM_CRITICAL: PermissionName[] = ['ViewChannel', 'SendMessages'];

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
  },
  async (ctx, emit) => {
    const out: HealthFinding[] = [];
    const kept = new Map<string, number>();
    for (const row of [...rowsOf(ctx, 'MemoryConfig')].sort((a, b) => a.id - b.id)) {
      const id = row.forumChannelId;
      const at: FindingTarget = { entity: 'MemoryConfig', rowId: row.id, field: 'forumChannelId', refId: id };
      const name = { name: row.channelName };
      const keptId = kept.get(id);
      if (keptId !== undefined) {
        // The channel picker lists the forum twice, and commands run in its posts use only one config.
        out.push(
          emit('duplicate', 'cosmetic', 'manual', { ...at, params: { ...name, channelId: id, keptRowId: keptId } }),
        );
        continue;
      }
      kept.set(id, row.id);
      const problem = channelProblem(ctx, id, ['forum'], FORUM_PERMS);
      if (problem) {
        const params = { ...name, ...channelParams(id, problem) };
        const repair = problem.problem === 'missing' ? 'auto' : 'manual';
        out.push(emit(problem.problem, channelSeverity(problem, FORUM_CRITICAL), repair, { ...at, params }));
      } else if (row.messageId && (await threadStatus(ctx, 'memory.welcome', row.messageId)) === 'missing') {
        const params = { ...name, channelId: id };
        out.push(
          emit('welcome_missing', 'cosmetic', 'confirm', { ...at, field: 'messageId', refId: row.messageId, params }),
        );
      }
    }
    return out;
  },
);

const tags = defineCheck(
  {
    id: 'memory.tag',
    system: 'memory',
    entities: ['MemoryConfig', 'MemoryTag'],
    isConfigured,
    names: ['orphan', 'not_in_forum'],
  },
  (ctx, emit) => {
    const forumsById = liveForums(ctx);
    const out: HealthFinding[] = [];
    for (const tag of rowsOf(ctx, 'MemoryTag')) {
      const at: FindingTarget = { entity: 'MemoryTag', rowId: tag.id, params: { name: tag.name } };
      if (!forumsById.has(tag.memoryConfigId)) {
        out.push(emit('orphan', 'cosmetic', 'auto', { ...at, field: 'memoryConfigId' }));
        continue;
      }
      // A gone or wrong-type forum is reported once by memory.forum.
      const forum = forumsById.get(tag.memoryConfigId);
      if (!forum || !('availableTags' in forum) || forum.availableTags.some(t => t.id === tag.discordTagId)) continue;
      // Posts can't carry a tag the forum doesn't have, so memories with this category or status lose it.
      const target = { ...at, field: 'discordTagId', ...(tag.discordTagId ? { refId: tag.discordTagId } : {}) };
      out.push(emit('not_in_forum', 'degraded', 'confirm', target));
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
  },
  async (ctx, emit) => {
    const forumsById = liveForums(ctx);
    const out: HealthFinding[] = [];
    let lookups = true;
    for (const item of rowsOf(ctx, 'MemoryItem')) {
      const at: FindingTarget = { entity: 'MemoryItem', rowId: item.id, params: { title: item.title } };
      if (!forumsById.has(item.memoryConfigId)) {
        out.push(emit('orphan', 'cosmetic', 'auto', { ...at, field: 'memoryConfigId' }));
        continue;
      }
      // Threads in a gone forum went with it; memory.forum reports that once.
      if (!lookups || !forumsById.get(item.memoryConfigId)) continue;
      const status = await threadStatus(ctx, 'memory.thread', item.threadId);
      // Budget spent: the runner lists the label as not checked, so stop asking.
      if (status === 'skipped') lookups = false;
      if (status === 'missing')
        out.push(emit('thread_missing', 'cosmetic', 'auto', { ...at, field: 'threadId', refId: item.threadId }));
    }
    return out;
  },
);

export const MEMORY_CHECKS: readonly HealthCheck[] = [forums, tags, items];

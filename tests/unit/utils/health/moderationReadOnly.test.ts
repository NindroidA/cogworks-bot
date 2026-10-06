/**
 * Read-only guarantee for the moderation checks: a messy guild run through the
 * real registry and the real repo loader finds problems in every system, never
 * writes, loads each entity with one guild-scoped find, and never reports
 * another guild's rows. Also the deep-mode REST budget across the real checks.
 */
import { describe, expect, test } from 'bun:test';
import { ChannelType } from 'discord.js';
import { HEALTH_ENTITIES, repoRowLoader } from '../../../../src/utils/health/context';
import { runHealthCheck } from '../../../../src/utils/health/runner';
import { type FakeChannelInit, makeFakeGuild } from '../../../helpers/fakeGuild';
import { type FakeRepo, makeFakeRepo, writeCallCount } from '../../../helpers/fakeRepo';
import { ADMIN_BOT, G, withMessages, withThreadFetch } from './moderationHelpers';

const OTHER = '100000000000000002';
const TEXT = '300000000000000001';
const FORUM = '300000000000000002';
const GONE = '300000000000000666';
const ROLE = '200000000000000001';
const DELETED_ROLE = '200000000000000666';

function repos(): Record<string, FakeRepo> {
  const all: Record<string, FakeRepo> = Object.fromEntries(Object.keys(HEALTH_ENTITIES).map(name => [name, makeFakeRepo()]));
  all.RulesConfig = makeFakeRepo([
    { id: 1, guildId: G, channelId: GONE, messageId: '1', roleId: ROLE, emoji: '✅' },
    { id: 2, guildId: OTHER, channelId: GONE, messageId: '2', roleId: ROLE, emoji: 'not ours' },
  ]);
  all.ReactionRoleMenu = makeFakeRepo([
    {
      id: 1,
      guildId: G,
      channelId: TEXT,
      messageId: '3',
      name: 'Colors',
      mode: 'normal',
      options: [{ id: 1, menuId: 1, emoji: '🔴', roleId: DELETED_ROLE, sortOrder: 0 }],
    },
    { id: 2, guildId: OTHER, channelId: GONE, messageId: '4', name: 'Not ours', mode: 'normal', options: [] },
  ]);
  all.MemoryConfig = makeFakeRepo([{ id: 1, guildId: G, channelName: 'Bugs', forumChannelId: FORUM, messageId: null }]);
  all.MemoryTag = makeFakeRepo([
    { id: 1, guildId: G, memoryConfigId: 99, discordTagId: null, name: 'Orphan', tagType: 'category' },
    { id: 2, guildId: OTHER, memoryConfigId: 98, discordTagId: null, name: 'Not ours', tagType: 'category' },
  ]);
  all.MemoryItem = makeFakeRepo([{ id: 1, guildId: G, memoryConfigId: 99, threadId: GONE, title: 'Orphan' }]);
  return all;
}

describe('read-only guarantee (moderation checks, real registry and repo loader)', () => {
  test('finds problems in every moderation system, stays guild-scoped, and never writes', async () => {
    const fakes = repos();
    const loader = repoRowLoader(target => fakes[(target as { name: string }).name]);
    const forum = { id: FORUM, type: ChannelType.GuildForum, availableTags: [] } as FakeChannelInit;
    const guild = makeFakeGuild({ ...ADMIN_BOT, roles: [{ id: ROLE, position: 1 }], channels: [{ id: TEXT }, forum] });

    const report = await runHealthCheck(guild, {}, { loadRows: loader });

    const found = (system: keyof typeof report.systems) => report.systems[system]?.findings.map(f => f.code);
    expect(found('rules')).toEqual(['rules.config.channel_missing']);
    expect(found('reactionRole')).toEqual(['reactionRole.option.role_missing']);
    expect(found('memory')).toEqual(['memory.tag.orphan', 'memory.item.orphan']);
    expect(report.systems.rules?.status).toBe('fail');
    expect(report.systems.memory?.status).toBe('warn');
    expect(JSON.stringify(report)).not.toContain('Not ours');
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);

    for (const [name, repo] of Object.entries(fakes)) {
      expect({ name, writes: writeCallCount(repo) }).toEqual({ name, writes: 0 });
      expect({ name, finds: repo.findCalls }).toEqual({ name, finds: [{ where: { guildId: G } }] });
    }
  });

  test('a guild with none of these set up reports them as not configured', async () => {
    const fakes = Object.fromEntries(Object.keys(HEALTH_ENTITIES).map(name => [name, makeFakeRepo()]));
    const loader = repoRowLoader(target => fakes[(target as { name: string }).name]);
    const report = await runHealthCheck(makeFakeGuild(), {}, { loadRows: loader });
    for (const system of ['rules', 'reactionRole', 'memory'] as const) {
      expect({ system, status: report.systems[system]?.status }).toEqual({ system, status: 'not_configured' });
    }
  });
});

describe('deep-mode REST budget (real registry)', () => {
  test('deleted menu messages are all looked up before archived memory posts, which stop at 20', async () => {
    const empty = Object.fromEntries(Object.keys(HEALTH_ENTITIES).map(name => [name, [] as unknown[]]));
    const rows: Record<string, unknown[]> = {
      ...empty,
      ReactionRoleMenu: Array.from({ length: 40 }, (_, i) => ({
        id: i + 1,
        guildId: G,
        channelId: TEXT,
        messageId: `40000000000000${String(1000 + i)}`,
        name: `Menu ${i + 1}`,
        mode: 'normal',
        options: [{ id: i + 1, menuId: i + 1, emoji: '🔴', roleId: ROLE, sortOrder: 0 }],
      })),
      MemoryConfig: [{ id: 1, guildId: G, channelName: 'Bugs', forumChannelId: FORUM, messageId: null }],
      MemoryItem: Array.from({ length: 200 }, (_, i) => ({
        id: i + 1,
        guildId: G,
        memoryConfigId: 1,
        threadId: `31000000000000${String(1000 + i)}`,
        title: `Memory ${i + 1}`,
      })),
    };
    const forum = { id: FORUM, type: ChannelType.GuildForum, availableTags: [] } as FakeChannelInit;
    const guild = makeFakeGuild({ ...ADMIN_BOT, roles: [{ id: ROLE, position: 1 }], channels: [{ id: TEXT }, forum] });
    const messages = withMessages(guild, TEXT, []);
    const threads = withThreadFetch(guild, []);

    const report = await runHealthCheck(guild, { deep: true }, { loadRows: async entity => rows[entity] });

    const count = (code: string) => Object.values(report.systems).flatMap(s => s?.findings ?? []).filter(f => f.code === code).length;
    expect(count('reactionRole.menu.message_missing')).toBe(40);
    expect(messages).toHaveLength(40);
    expect(threads).toHaveLength(20);
    expect(count('memory.item.thread_missing')).toBe(20);
    expect(report.notChecked).toEqual(['rest:memory.thread']);
  });
});

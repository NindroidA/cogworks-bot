/**
 * Memory health checks: forums (type, permissions, duplicates, welcome post in
 * deep mode), tags (orphans, missing from the forum) and items (orphans,
 * deleted threads in deep mode), one pass and one or more fail cases each.
 */
import { describe, expect, test } from 'bun:test';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { createRestFetcher } from '../../../../src/utils/health/context';
import { getChecks } from '../../../../src/utils/health/registry';
import { runCheck } from '../../../../src/utils/health/runner';
import { type FakeChannelInit, type FakeGuildInit, makeFakeGuild } from '../../../helpers/fakeGuild';
import { makeCheckContext } from '../../../helpers/healthContext';
import { ADMIN_BOT, codes, G, runChecks, withThreadFetch } from './moderationHelpers';

const FORUM = '300000000000000001';
const TEXT = '300000000000000002';
const GONE = '300000000000000666';
const WELCOME = '310000000000000001';
const THREAD = '310000000000000002';
const OLD_THREAD = '310000000000000003';
const TAG = '320000000000000001';

const forum = (init: Partial<FakeChannelInit> = {}) =>
  ({ id: FORUM, type: ChannelType.GuildForum, availableTags: [{ id: TAG, name: 'Bug' }], ...init }) as FakeChannelInit;
const guild = (init: FakeGuildInit = {}): FakeGuildInit => ({ ...ADMIN_BOT, channels: [forum(), { id: TEXT }], ...init });
const config = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  guildId: G,
  channelName: 'Bugs',
  forumChannelId: FORUM,
  messageId: WELCOME,
  sortOrder: 0,
  ...overrides,
});
const tag = (id: number, overrides: Record<string, unknown> = {}) => ({
  id,
  guildId: G,
  memoryConfigId: 1,
  discordTagId: TAG,
  name: 'Bug',
  emoji: null,
  tagType: 'category',
  isDefault: true,
  ...overrides,
});
const item = (id: number, overrides: Record<string, unknown> = {}) => ({
  id,
  guildId: G,
  memoryConfigId: 1,
  threadId: THREAD,
  title: `Memory ${id}`,
  status: 'Open',
  ...overrides,
});

describe('memory.forum', () => {
  const id = 'memory.forum';

  test('pass: a forum the bot can use; no configs', async () => {
    expect(await runChecks(id, { MemoryConfig: [config()] }, guild())).toEqual([]);
    expect(await runChecks(id, { MemoryConfig: [] }, guild())).toEqual([]);
  });

  test('fail: deleted forum (auto: the channelDelete cleaner) or not a forum', async () => {
    const [gone] = await runChecks(id, { MemoryConfig: [config({ forumChannelId: GONE })] }, guild());
    expect(gone).toMatchObject({
      code: 'memory.forum.missing',
      system: 'memory',
      severity: 'block',
      repair: 'auto',
      rowId: 1,
      refId: GONE,
      params: { name: 'Bugs', channelId: GONE },
    });
    expect(codes(await runChecks(id, { MemoryConfig: [config({ forumChannelId: TEXT })] }, guild()))).toEqual([
      'memory.forum.wrong_type',
    ]);
  });

  test('permissions: Send Messages missing blocks, Manage Threads only degrades', async () => {
    const all = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.SendMessagesInThreads,
      PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.ManageThreads,
    ];
    const without = (flag: bigint) => guild({ channels: [forum({ botPermissions: all.filter(p => p !== flag) })] });
    const [blocked] = await runChecks(id, { MemoryConfig: [config()] }, without(PermissionFlagsBits.SendMessages));
    expect(blocked).toMatchObject({ code: 'memory.forum.permissions', severity: 'block', params: { permissions: 'SendMessages' } });
    const [degraded] = await runChecks(id, { MemoryConfig: [config()] }, without(PermissionFlagsBits.ManageThreads));
    expect(degraded).toMatchObject({ severity: 'degraded', repair: 'manual', params: { permissions: 'ManageThreads' } });
  });

  test('deep mode: missing Manage Threads does not hide a deleted welcome post', async () => {
    const perms = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages];
    const g = makeFakeGuild(guild({ channels: [forum({ botPermissions: perms })] }));
    withThreadFetch(g, []);
    const findings = await runChecks(id, { MemoryConfig: [config()] }, g, { deep: true });
    expect(codes(findings)).toEqual(['memory.forum.permissions', 'memory.forum.welcome_missing']);
    expect(findings[0]).toMatchObject({ severity: 'degraded' });
  });

  test('fail: the same forum set up twice reports the newer config once', async () => {
    const findings = await runChecks(id, { MemoryConfig: [config({ id: 7, channelName: 'Copy' }), config({ id: 3 })] }, guild());
    expect(codes(findings)).toEqual(['memory.forum.duplicate']);
    expect(findings[0]).toMatchObject({ severity: 'cosmetic', rowId: 7, params: { keptRowId: 3, name: 'Copy' } });
  });

  test('welcome post: an uncached thread is only looked up in deep mode', async () => {
    const g = makeFakeGuild(guild());
    const fetched = withThreadFetch(g, []);
    expect(await runChecks(id, { MemoryConfig: [config()] }, g)).toEqual([]);
    expect(fetched).toEqual([]);
    const [f] = await runChecks(id, { MemoryConfig: [config()] }, g, { deep: true });
    expect(f).toMatchObject({ code: 'memory.forum.welcome_missing', severity: 'cosmetic', repair: 'confirm', refId: WELCOME });
    withThreadFetch(g, [WELCOME]);
    expect(await runChecks(id, { MemoryConfig: [config()] }, g, { deep: true })).toEqual([]);
    expect(await runChecks(id, { MemoryConfig: [config({ messageId: null })] }, g, { deep: true })).toEqual([]);
  });
});

describe('memory.tag', () => {
  const id = 'memory.tag';

  test('pass: the tag is on its forum', async () => {
    expect(await runChecks(id, { MemoryConfig: [config()], MemoryTag: [tag(1)] }, guild())).toEqual([]);
  });

  test('fail: orphan tag whose config is gone', async () => {
    const [f] = await runChecks(id, { MemoryConfig: [config()], MemoryTag: [tag(2, { memoryConfigId: 99 })] }, guild());
    expect(f).toMatchObject({ code: 'memory.tag.orphan', severity: 'cosmetic', repair: 'auto', rowId: 2 });
  });

  test('fail: tag id not on the forum, or never linked', async () => {
    const rows = { MemoryConfig: [config()], MemoryTag: [tag(3, { discordTagId: '320000000000000999' }), tag(4, { discordTagId: null })] };
    const findings = await runChecks(id, rows, guild());
    expect(codes(findings)).toEqual(['memory.tag.not_in_forum', 'memory.tag.not_in_forum']);
    expect(findings[0]).toMatchObject({ severity: 'degraded', repair: 'confirm', refId: '320000000000000999' });
    expect(findings[1].refId).toBeUndefined();
  });

  test('a stale copy next to a linked tag of the same name is a duplicate, not a tag to add back', async () => {
    const stale = { discordTagId: '320000000000000999' };
    const rows = {
      MemoryConfig: [config(), config({ id: 2, forumChannelId: TEXT })],
      MemoryTag: [tag(3, { ...stale, name: 'bug' }), tag(8), tag(9, { memoryConfigId: 2, ...stale })],
    };
    const [f] = await runChecks(id, rows, guild());
    expect(f).toMatchObject({
      code: 'memory.tag.duplicate',
      severity: 'degraded',
      repair: 'confirm',
      rowId: 3,
      params: { name: 'bug', keptRowId: 8 },
    });
    // Same name, no linked copy: each one is missing from the forum.
    const unlinked = { MemoryConfig: [config()], MemoryTag: [tag(3, stale), tag(4, { discordTagId: null })] };
    expect(codes(await runChecks(id, unlinked, guild()))).toEqual(['memory.tag.not_in_forum', 'memory.tag.not_in_forum']);
  });

  test('fail: a tag type other than category or status', async () => {
    const [f] = await runChecks(id, { MemoryConfig: [config()], MemoryTag: [tag(6, { tagType: 'label' })] }, guild());
    expect(f).toMatchObject({
      code: 'memory.tag.invalid_type',
      severity: 'cosmetic',
      repair: 'manual',
      field: 'tagType',
      params: { name: 'Bug', tagType: 'label' },
    });
  });

  test('pass: a gone forum is left to memory.forum', async () => {
    const rows = { MemoryConfig: [config({ forumChannelId: GONE })], MemoryTag: [tag(5, { discordTagId: null })] };
    expect(await runChecks(id, rows, guild())).toEqual([]);
  });
});

describe('memory.item', () => {
  const id = 'memory.item';
  const threadGuild = () => guild({ channels: [forum(), { id: THREAD, type: ChannelType.PublicThread }] });

  test('pass: the thread is cached (active)', async () => {
    expect(await runChecks(id, { MemoryConfig: [config()], MemoryItem: [item(1)] }, threadGuild())).toEqual([]);
  });

  test('fail: orphan item whose config is gone', async () => {
    const [f] = await runChecks(id, { MemoryConfig: [config()], MemoryItem: [item(2, { memoryConfigId: 99 })] }, guild());
    expect(f).toMatchObject({ code: 'memory.item.orphan', severity: 'cosmetic', repair: 'auto', params: { title: 'Memory 2' } });
  });

  test('deleted thread: unknown without deep mode, missing with it', async () => {
    const g = makeFakeGuild(guild());
    withThreadFetch(g, [THREAD]);
    const rows = { MemoryConfig: [config()], MemoryItem: [item(1), item(2, { threadId: OLD_THREAD })] };
    expect(await runChecks(id, rows, g)).toEqual([]);
    const findings = await runChecks(id, rows, g, { deep: true });
    expect(codes(findings)).toEqual(['memory.item.thread_missing']);
    expect(findings[0]).toMatchObject({ rowId: 2, refId: OLD_THREAD, repair: 'auto' });
  });

  test('a spent REST budget stops the thread lookups but not the orphan scan', async () => {
    const check = getChecks().find(c => c.id === id)!;
    const g = makeFakeGuild(guild());
    const fetched = withThreadFetch(g, []);
    const rest = createRestFetcher({ concurrency: 1, timeoutMs: 1_000, maxCalls: 1 });
    const rows = {
      MemoryConfig: [config()],
      MemoryItem: [item(1, { threadId: OLD_THREAD }), item(2), item(3), item(4, { memoryConfigId: 99 })],
    };
    const result = await runCheck(check, makeCheckContext({ guild: g, rows, deep: true, rest }));
    expect(codes(result.findings)).toEqual(['memory.item.thread_missing', 'memory.item.orphan']);
    expect(fetched).toEqual([OLD_THREAD]);
    expect(rest.skipped).toEqual(['memory.thread']);
  });
});
